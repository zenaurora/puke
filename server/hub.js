// 连接层：WebSocket 会话、身份、消息路由、房间注册表与回收
import { Room, newRoomCode } from './room.js';
import { newToken, ADMIN_KEY } from './auth.js';

const IDLE_CHECK_MS = 60 * 1000;

export class Hub {
  constructor(store) {
    this.store = store;
    this.rooms = new Map();     // code → Room
    this.conns = new Set();     // {ws, key, token, isAdmin, roomCode, alive}
    this.sessions = new Map();  // token → {key, isAdmin}
    const gc = setInterval(() => this._gc(), IDLE_CHECK_MS);
    gc.unref?.(); // 不阻止测试进程退出
  }

  // —— 连接管理 ——————————————————————————————

  onConnection(ws) {
    const conn = { ws, key: null, token: null, isAdmin: false, roomCode: null, alive: true };
    this.conns.add(conn);
    ws.on('message', raw => this._onMessage(conn, raw));
    ws.on('pong', () => { conn.alive = true; });
    ws.on('close', () => {
      this.conns.delete(conn);
      if (conn.roomCode) {
        const room = this.rooms.get(conn.roomCode);
        if (room) room.broadcast(); // 让其他人看到离线状态
      }
    });
    ws.on('error', () => {});
  }

  sendTo(conn, msg) {
    if (conn.ws.readyState === 1) {
      try { conn.ws.send(JSON.stringify(msg)); } catch {}
    }
  }

  deny(conn, message, code = 'error') {
    this.sendTo(conn, { type: 'denied', code, message });
  }

  connsInRoom(code) {
    return [...this.conns].filter(c => c.roomCode === code && c.key);
  }

  isConnected(key) {
    return [...this.conns].some(c => c.key === key);
  }

  // —— 消息路由 ——————————————————————————————

  _onMessage(conn, raw) {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return this.deny(conn, '消息格式错误'); }
    if (!msg || typeof msg.type !== 'string') return this.deny(conn, '消息格式错误');
    conn.alive = true;
    this.lastActive = Date.now();

    // 简单限流：每连接 3 秒内最多 40 条消息
    const now = Date.now();
    conn.msgTimes = (conn.msgTimes || []).filter(t => now - t < 3000);
    if (conn.msgTimes.push(now) > 40) return this.deny(conn, '操作太频繁，请稍候', 'rate_limited');
    // 聊天单独更严：5 秒内最多 5 条
    if (msg.type === 'chat') {
      conn.chatTimes = (conn.chatTimes || []).filter(t => now - t < 5000);
      if (conn.chatTimes.push(now) > 5) return this.deny(conn, '聊天太频繁，请稍候', 'rate_limited');
    }

    switch (msg.type) {
      case 'enter': return this._enter(conn, msg);
      case 'resume': return this._resume(conn, msg);
      case 'createRoom': return this._createRoom(conn, msg);
      case 'joinRoom': return this._joinRoom(conn, msg);
      case 'leaveRoom': return this._leaveRoom(conn);
      case 'sit': return this._roomOp(conn, room => room.sit(conn.key, msg.seat | 0));
      case 'stand': return this._roomOp(conn, room => room.stand(conn.key));
      case 'rebuy': return this._roomOp(conn, room => room.rebuy(conn.key));
      case 'start': return this._roomOp(conn, room => room.startGame(conn.key));
      case 'closeRoom': return this._roomOp(conn, room => room.requestClose(conn.key));
      case 'pause': return this._roomOp(conn, room => room.pauseToggle(conn.key));
      case 'nextHand': return this._roomOp(conn, room => room.nextHandNow(conn.key));
      case 'action': return this._roomOp(conn, room => room.act(conn.key, msg.action, msg.to));
      case 'chat': return this._roomOp(conn, room => { room.chatMsg(conn.key, msg.text); });
      case 'kick': return this._roomOp(conn, room => {
        const err = room.kick(conn.key, String(msg.key || ''));
        if (!err) {
          for (const c of this.conns) {
            if (c.key === String(msg.key) && c.roomCode === room.code) {
              c.roomCode = null;
              this.sendTo(c, { type: 'left', kicked: true });
            }
          }
        }
        return err;
      });
      case 'lobby': return this.sendTo(conn, { type: 'lobby', rooms: this._roomList() });
      case 'leaderboard': {
        if (!conn.key) return this.deny(conn, '请先进入身份');
        return this.sendTo(conn, { type: 'leaderboard', rows: this.store.leaderboard() });
      }
      case 'profile': {
        if (!conn.key) return this.deny(conn, '请先进入身份');
        const p = this.store.profileOf(String(msg.key || conn.key));
        if (!p) return this.deny(conn, '玩家不存在');
        return this.sendTo(conn, { type: 'profile', profile: p });
      }
      case 'admin.addPlayer': return this._adminOp(conn, () => {
        const r = this.store.addPlayer(msg.name, msg.number, msg.chips);
        return r.error || null;
      });
      case 'admin.list': {
        if (!conn.isAdmin) return this.deny(conn, '需要管理员身份');
        const players = Object.entries(this.store.players)
          .map(([key, p]) => ({ key, name: p.name, number: p.number, chips: p.chips }))
          .sort((a, b) => b.chips - a.chips);
        return this.sendTo(conn, { type: 'admin.list', players });
      }
      case 'admin.adjust': return this._adminOp(conn, () => {
        const p = this.store.getPlayer(msg.key);
        if (!p) return '玩家不存在';
        const delta = Math.round(Number(msg.delta) || 0);
        if (!delta) return '调整额度不能为 0';
        this.store.applyDelta(msg.key, delta, '', msg.note || '管理员调整');
        return null;
      });
      case 'admin.setPassword': return this._adminOp(conn, () => {
        if (typeof msg.pw !== 'string' || msg.pw.length < 4) return '密码至少 4 位';
        this.store.setAdminPassword(msg.pw);
        return null;
      });
      default: return this.deny(conn, '未知消息类型');
    }
  }

  // —— 身份 ——————————————————————————————

  _enter(conn, msg) {
    const name = String(msg.name || '').trim().slice(0, 20);
    const number = Number(msg.number);
    if (!name || !Number.isInteger(number) || number < 0 || number > 999) {
      return this.deny(conn, '请输入名称和编号（编号为 0-999 的整数）');
    }
    const key = `${name.toLowerCase()}#${number}`;
    const player = this.store.getPlayer(key);
    if (!player) {
      return this.deny(conn, '该名称尚未登记，请联系管理员开通', 'not_registered');
    }
    const isAdmin = key === ADMIN_KEY;
    if (isAdmin) {
      // 有效的管理员令牌可免密进入
      const sess = this.sessions.get(String(msg.adminToken || ''));
      const byToken = sess?.isAdmin === true;
      if (!byToken && (typeof msg.adminPw !== 'string' || !this.store.verifyAdminPassword(msg.adminPw))) {
        return this.deny(conn, '管理员密码错误', 'need_admin_pw');
      }
    }
    const token = newToken();
    this.sessions.set(token, { key, isAdmin });
    conn.key = key; conn.token = token; conn.isAdmin = isAdmin;
    this.sendTo(conn, {
      type: 'entered', token, key, isAdmin,
      profile: this.store.profileOf(key),
    });
    this.sendTo(conn, { type: 'lobby', rooms: this._roomList() });
  }

  _resume(conn, msg) {
    const sess = this.sessions.get(String(msg.token || ''));
    if (!sess) return this.deny(conn, '会话已过期，请重新进入', 'session_expired');
    conn.key = sess.key; conn.token = sess.token ?? msg.token; conn.isAdmin = sess.isAdmin;
    this.sendTo(conn, {
      type: 'entered', token: conn.token, key: conn.key, isAdmin: conn.isAdmin,
      profile: this.store.profileOf(conn.key),
    });
    // 若上次断线时在房间里，自动回到房间
    for (const room of this.rooms.values()) {
      if (room.has(conn.key)) {
        conn.roomCode = room.code;
        this.sendTo(conn, { type: 'joined', code: room.code });
        this.sendTo(conn, { type: 'room', room: room.snapshotFor(conn.key) });
        room.broadcast(); // 让其他人看到上线状态
        return;
      }
    }
    this.sendTo(conn, { type: 'lobby', rooms: this._roomList() });
  }

  // —— 房间 ——————————————————————————————

  _roomOp(conn, fn) {
    if (!conn.key) return this.deny(conn, '请先进入身份');
    const room = this.rooms.get(conn.roomCode);
    if (!room || !room.has(conn.key)) return this.deny(conn, '你不在任何房间里');
    const err = fn(room);
    if (typeof err === 'string' && err) return this.deny(conn, err);
    room.lastActive = Date.now();
    room.broadcast();
  }

  _createRoom(conn, msg) {
    if (!conn.key) return this.deny(conn, '请先进入身份');
    const me = this.store.getPlayer(conn.key);
    const s = msg.settings || {};
    const startingChips = Math.min(1000000, Math.max(50, Math.round(Number(s.startingChips) || 1000)));
    const sb = Math.min(startingChips, Math.max(1, Math.round(Number(s.sb) || Math.max(1, Math.round(startingChips / 100)))));
    const bb = Math.min(startingChips, Math.max(sb, Math.round(Number(s.bb) || sb * 2)));
    const room = new Room(this, newRoomCode(this.rooms), String(s.name || `${me.name} #${me.number} 的房间`).slice(0, 30), {
      startingChips, sb, bb,
      ante: Math.max(0, Math.round(Number(s.ante) || 0)),
      actionTime: [0, 15, 30, 60].includes(Number(s.actionTime)) ? Number(s.actionTime) : 30,
      rebuys: s.rebuys !== false,
    }, conn.key);
    this.rooms.set(room.code, room);
    room.onDirty = () => room.broadcast();
    conn.roomCode = room.code;
    room.join(conn.key, this.store.getPlayer(conn.key).name);
    this.sendTo(conn, { type: 'joined', code: room.code });
    room.broadcast();
    this._broadcastLobby();
  }

  _joinRoom(conn, msg) {
    if (!conn.key) return this.deny(conn, '请先进入身份');
    const code = String(msg.code || '').trim().toUpperCase();
    const room = this.rooms.get(code);
    if (!room) return this.deny(conn, '房间不存在，请核对房间码');
    if (conn.roomCode === code) return; // 已在房里
    if (conn.roomCode) this._leaveRoom(conn, true);
    conn.roomCode = code;
    if (!room.has(conn.key)) room.join(conn.key, this.store.getPlayer(conn.key).name);
    this.sendTo(conn, { type: 'joined', code });
    room.broadcast();
    this._broadcastLobby();
  }

  _leaveRoom(conn, silent = false) {
    const room = this.rooms.get(conn.roomCode);
    conn.roomCode = null;
    if (!room) return;
    room.leave(conn.key);
    this.sendTo(conn, { type: 'left' });
    room.broadcast();
    if (room.isEmpty()) this._closeRoom(room.code);
    if (!silent) this._broadcastLobby();
  }

  _closeRoom(code) {
    const room = this.rooms.get(code);
    if (!room) return;
    room.close();
    this.rooms.delete(code);
    for (const c of this.connsInRoom(code)) {
      c.roomCode = null;
      this.sendTo(c, { type: 'left', closed: true });
    }
    this._broadcastLobby();
  }

  _roomList() {
    return [...this.rooms.values()].map(r => ({
      code: r.code, name: r.name,
      seated: r.seats.filter(Boolean).length,
      playing: !!r.hand && !r.hand.finished,
      settings: r.settings,
    }));
  }

  _broadcastLobby() {
    const rooms = this._roomList();
    for (const c of this.conns) {
      if (c.key && !c.roomCode) this.sendTo(c, { type: 'lobby', rooms });
    }
  }

  // —— 管理员 ——————————————————————————————

  _adminOp(conn, fn) {
    if (!conn.isAdmin) return this.deny(conn, '需要管理员身份');
    const err = fn();
    if (typeof err === 'string' && err) return this.deny(conn, err);
    this.sendTo(conn, { type: 'admin.ok' });
  }

  // —— 回收 ——————————————————————————————

  _gc() {
    // 心跳清理
    for (const conn of this.conns) {
      if (conn.alive === false) { try { conn.ws.terminate(); } catch {} this.conns.delete(conn); continue; }
      conn.alive = false;
      try { conn.ws.ping(); } catch {}
    }
    // 长期无人连接的房间自动结算关闭
    for (const room of [...this.rooms.values()]) {
      if (!room.hasConnections() && room.idleMs() > 5 * 60 * 1000) {
        console.log(`[回收] 房间 ${room.code} 长时间无人，自动结算并关闭`);
        this._closeRoom(room.code);
      }
    }
  }

  // 供 ping 间隔使用
  get lastActive() { return this._lastActive || 0; }
  set lastActive(v) { this._lastActive = v; }
}
