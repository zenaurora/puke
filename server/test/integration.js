// 集成测试：脚本化 WebSocket 客户端跑完整流程
// 身份进入 → 管理员添加玩家 → 建房 → 入座 → 完整一手牌（含全下边池）→ 离座结算 → 走势校验
// 运行：node server/test/integration.js（自动起独立服务器实例，随机端口，临时 DATA_DIR）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { Store } from '../store.js';
import { Hub } from '../hub.js';

// —— 迷你服务器夹具 ———————————————————————————————

async function startServer() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poker-test-'));
  process.env.ADMIN_PASSWORD = 'test-admin-pw';
  process.env.DATA_DIR = dataDir; // 隔离存储目录
  const store = new Store();
  const hub = new Hub(store);
  const server = http.createServer(() => {});
  const wss = new WebSocketServer({ server });
  wss.on('connection', ws => hub.onConnection(ws));
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  return {
    port, store, dataDir,
    url: `ws://localhost:${port}`,
    async stop() {
      store.flushAll();
      server.close();
      await new Promise(r => server.closeAllConnections?.() || r());
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

// 可等待的客户端
class Client {
  constructor(url) { this.ws = new WebSocket(url); this.queue = []; this.waiters = []; this.trace = []; }
  static async connect(url) {
    const c = new Client(url);
    await new Promise((res, rej) => { c.ws.on('open', res); c.ws.on('error', rej); });
    c.ws.on('message', raw => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'entered') c.token = msg.token;
      c.trace.push(msg.type + (msg.code ? `(${msg.code})` : '') + (msg.message ? `(${msg.message})` : ''));
      if (c.trace.length > 8) c.trace.shift();
      const w = c.waiters.shift();
      if (w) w(msg); else c.queue.push(msg);
    });
    return c;
  }
  send(obj) { this.ws.send(JSON.stringify(obj)); }
  recv(timeoutMs = 3000) {
    if (this.queue.length) return Promise.resolve(this.queue.shift());
    return new Promise((res, rej) => {
      const w = m => { clearTimeout(t); res(m); };
      const t = setTimeout(() => {
        const i = this.waiters.indexOf(w);
        if (i >= 0) this.waiters.splice(i, 1); // 超时必须摘除 waiter，否则会吞掉后续消息
        rej(new Error('等待消息超时'));
      }, timeoutMs);
      this.waiters.push(w);
    });
  }
  // 等到第一个满足条件的消息（跳过无关推送）
  async waitFor(pred, timeoutMs = 3000, desc = '消息') {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`等待${desc}超时；最近消息: ${this.trace.join(' → ')}`);
      let m;
      try { m = await this.recv(left + 1000); } catch { continue; }
      if (pred(m)) return m;
    }
  }
  close() { this.ws.close(); }
}

// —— 测试 ————————————————————————————————————

test('完整流程：进入 → 管理 → 建房 → 对局 → 结算', async t => {
  const srv = await startServer();
  t.after(() => srv.stop());
  const url = srv.url;

  // 管理员进入
  const admin = await Client.connect(url);
  admin.send({ type: 'enter', name: 'Max', number: 33, adminPw: 'test-admin-pw' });
  const entered = await admin.waitFor(m => m.type === 'entered', 3000, 'entered');
  assert.equal(entered.isAdmin, true);
  assert.equal(entered.profile.chips, 1000, '管理员初始 1000');

  // 密码错误被拒
  const bad = await Client.connect(url);
  bad.send({ type: 'enter', name: 'Max', number: 33, adminPw: 'wrong' });
  const denied = await bad.waitFor(m => m.type === 'denied', 3000, 'denied');
  assert.equal(denied.code, 'need_admin_pw');
  bad.close();

  // 未登记玩家被拒
  const ghost = await Client.connect(url);
  ghost.send({ type: 'enter', name: 'Lily', number: 1 });
  assert.equal((await ghost.waitFor(m => m.type === 'denied')).code, 'not_registered');
  ghost.close();

  // 管理员添加 3 名玩家
  for (const [name, num] of [['Lily', 1], ['Tom', 2], ['Jerry', 3]]) {
    admin.send({ type: 'admin.addPlayer', name, number: num, chips: 1000 });
    const ack = await admin.waitFor(m => m.type === 'denied' || m.type === 'admin.ok', 3000, `添加 ${name} 的确认`);
    assert.notEqual(ack.type, 'denied', `添加 ${name} 失败: ${ack.message ?? ''}`);
  }

  // 房间列表（主动请求）
  admin.send({ type: 'lobby' });
  await admin.waitFor(m => m.type === 'lobby', 3000, 'lobby');

  // 各玩家进入
  const players = {};
  for (const [name, num] of [['Lily', 1], ['Tom', 2], ['Jerry', 3]]) {
    const c = await Client.connect(url);
    c.send({ type: 'enter', name, number: num });
    const e = await c.waitFor(m => m.type === 'entered', 3000, 'entered');
    assert.equal(e.isAdmin, false);
    players[name] = c;
  }

  // 管理员建房
  admin.send({ type: 'createRoom', settings: { name: '测试房', startingChips: 500, sb: 5, bb: 10, actionTime: 0 } });
  const joined = await admin.waitFor(m => m.type === 'joined', 3000, 'joined');
  const code = joined.code;

  // 其他人凭房间码加入
  for (const c of Object.values(players)) {
    c.send({ type: 'joinRoom', code });
    await c.waitFor(m => m.type === 'joined', 3000, 'joined');
  }

  // 入座（管理员 0 号，其余 2/4 号）——等待座位状态真正生效，避免跨连接竞态
  const waitSeats = async (client, n, desc) => {
    const m = await client.waitFor(
      x => x.type === 'room' && x.room.seats.filter(Boolean).length >= n, 5000, desc);
    return m;
  };
  admin.send({ type: 'sit', seat: 0 });
  await waitSeats(admin, 1, '管理员入座生效');
  players.Lily.send({ type: 'sit', seat: 2 });
  await waitSeats(players.Lily, 2, 'Lily 入座生效');
  players.Tom.send({ type: 'sit', seat: 4 });
  await waitSeats(players.Tom, 3, 'Tom 入座生效');

  // 未入座的 Jerry 保持旁观
  players.Jerry.send({ type: 'chat', text: '我先看看' });
  await waitSeats(players.Jerry, 3, '旁观者看到满座');

  // 管理员开始游戏
  admin.send({ type: 'start' });
  const firstRoom = await admin.waitFor(
    m => m.type === 'room' && m.room.hand, 3000, '首手快照');
  assert.equal(firstRoom.room.handNo, 1);
  assert.ok(Array.isArray(adminHole(firstRoom)), '管理员应收到自己的底牌');

  function adminHole(m) { return m.room.myHole; }

  // 验证旁观者收不到任何底牌
  const jerrySnap = await players.Jerry.waitFor(
    m => m.type === 'room' && m.room.hand && m.room.hand.board !== undefined, 3000, '旁观快照');
  for (const s of jerrySnap.room.seats) if (s) assert.equal(s.hole, null, '旁观者不能看到任何底牌');
  assert.equal(jerrySnap.room.myHole.length, 0);

  // 三家并发驱动到本手结束：initial 为该客户端已消费的最后一张快照（可空）
  // 轮到谁（myLegal 非空）谁全下，走边池路径
  async function driveToHandend(client, initial = null, timeoutMs = 15000) {
    let m = initial;
    for (;;) {
      if (!m) m = await client.waitFor(x => x.type === 'room', 5000, 'room 快照');
      const r = m.room;
      if (r.phase === 'handend' || (r.hand && r.hand.finished)) return m;
      if (r.myLegal && r.hand && !r.hand.finished) {
        client.send({ type: 'action', action: 'allin' });
      }
      m = null;
    }
  }
  const [endA, endB, endC] = await Promise.all([
    driveToHandend(admin, firstRoom),
    driveToHandend(players.Lily),
    driveToHandend(players.Tom),
  ]);

  for (const m of [endA, endB, endC]) {
    assert.equal(m.room.hand.finished, true);
    assert.equal(m.room.hand.board.length, 5, '公共牌应发满 5 张');
    assert.ok(m.room.hand.showdown, '应有摊牌结果');
  }
  // 摊牌时各家底牌互相可见
  const stacks = Object.fromEntries(endA.room.seats.filter(Boolean).map(s => [s.name, s.stack]));
  const total = Object.values(stacks).reduce((a, b) => a + b, 0);
  assert.equal(total, 1500, '三家各买入 500，桌上总量守恒');

  // 等一手结束后的自动续手提示出现（phase handend）
  await players.Tom.waitFor(m => m.type === 'room' && (m.room.phase === 'handend' || m.room.phase === 'playing'), 10000, '下一手调度');

  // 全部站起 → 结算
  for (const c of [admin, players.Lily, players.Tom]) {
    c.send({ type: 'stand' });
  }
  const settled = await admin.waitFor(
    m => m.type === 'room' && m.room.seats.every(s => s === null), 5000, '全部离座');
  assert.ok(settled);

  // 校验余额：每人余额 = 1000 + (桌上筹码 - 500)
  const NUMS = { lily: 1, tom: 2, jerry: 3, max: 33 };
  const expect = Object.entries(stacks).map(([name, chips]) => [name, 1000 + chips - 500]);
  for (const [name, want] of expect) {
    const p = srv.store.getPlayer(`${name.toLowerCase()}#${NUMS[name.toLowerCase()]}`);
    assert.ok(p, `应找到 ${name} 的档案`);
    assert.equal(p.chips, want, `${name} 结算后余额应为 ${want}`);
    const last = p.history[p.history.length - 1];
    assert.ok(last.note.includes('对局结算'));
  }
  // Jerry 没上桌，余额不变
  assert.equal(srv.store.getPlayer('jerry#3').chips, 1000);

  // admin.adjust 留痕
  admin.send({ type: 'admin.adjust', key: 'jerry#3', delta: -200, note: '测试扣款' });
  await admin.waitFor(m => m.type === 'admin.ok', 3000, 'admin.ok');
  assert.equal(srv.store.getPlayer('jerry#3').chips, 800);
  const jerryProfile = srv.store.getPlayer('jerry#3');
  assert.equal(jerryProfile.history[jerryProfile.history.length - 1].note, '测试扣款');

  // 断线重连：用 token resume 自动回到房间
  const lilyToken = players.Lily.token;
  players.Lily.close();
  const reLily = await Client.connect(url);
  reLily.send({ type: 'resume', token: lilyToken });
  const resumed = await reLily.waitFor(m => m.type === 'entered', 3000, 'resume entered');
  assert.equal(resumed.key, 'lily#1');
  await reLily.waitFor(m => m.type === 'joined', 3000, 'resume 回到房间');

  // 离开房间
  for (const c of [admin, players.Tom, reLily]) c.send({ type: 'leaveRoom' });
  await admin.waitFor(m => m.type === 'left', 3000, 'left');

  admin.close(); players.Tom.close(); players.Jerry.close(); reLily.close();
});
