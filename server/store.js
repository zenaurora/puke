// 本地 JSON 持久化：玩家档案、配置、进行中对局台账
// 原子写入（临时文件 + rename），变更后防抖落盘
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ADMIN_PLAYER_KEY = 'max#33';
const dataDir = () => process.env.DATA_DIR || path.join(process.cwd(), 'data');

function ensureDir() { fs.mkdirSync(dataDir(), { recursive: true }); }

function loadJson(name, fallback) {
  const file = path.join(dataDir(), name);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function saveJsonSync(name, obj) {
  ensureDir();
  const file = path.join(dataDir(), name);
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, file);
}

export function hashPassword(pw, salt) {
  salt = salt || crypto.randomBytes(8).toString('hex');
  const h = crypto.scryptSync(String(pw), salt, 16).toString('hex');
  return `${salt}:${h}`;
}

export function verifyPassword(pw, stored) {
  if (!stored) return false;
  const [salt] = stored.split(':');
  return hashPassword(pw, salt) === stored;
}

export class Store {
  constructor() {
    this.players = loadJson('players.json', {});   // key → {name, number, chips, createdAt, history[]}
    this.config = loadJson('config.json', {});     // {adminPassword}
    this.active = loadJson('active.json', {});     // roomCode → {players: {key: {buys, chips, roomName}}, startedAt}
    this._timers = new Map();
    this._initAdmin();
    this._settleOrphaned();
  }

  // —— 管理员 ——————————————————————————————

  _initAdmin() {
    // 确保管理员账号存在
    if (!this.players[ADMIN_PLAYER_KEY]) {
      this.players[ADMIN_PLAYER_KEY] = {
        name: 'max', number: 33, chips: 1000,
        createdAt: Date.now(),
        history: [{ t: Date.now(), room: '', delta: 1000, balance: 1000, note: '初始发放' }],
      };
      this._savePlayersSoon();
    }
    if (!this.config.adminPassword) {
      // 优先环境变量，否则随机生成并打印
      const pw = process.env.ADMIN_PASSWORD || crypto.randomBytes(4).toString('hex');
      this.config.adminPassword = hashPassword(pw);
      this._saveConfig();
      if (!process.env.ADMIN_PASSWORD) {
        console.log('========================================');
        console.log('  管理员（max #33）初始密码: ' + pw);
        console.log('  请妥善保存，可在 data/config.json 中更换');
        console.log('========================================');
      }
    }
  }

  verifyAdminPassword(pw) { return verifyPassword(pw, this.config.adminPassword); }

  setAdminPassword(pw) {
    this.config.adminPassword = hashPassword(pw);
    this._saveConfig();
  }

  // —— 玩家档案 ——————————————————————————————

  static playerKey(name, number) {
    return `${String(name).trim().toLowerCase()}#${Number(number)}`;
  }

  getPlayer(key) { return this.players[key] || null; }

  // 管理员添加玩家
  addPlayer(name, number, chips = 1000) {
    name = String(name || '').trim();
    number = Number(number);
    chips = Math.round(Number(chips));
    if (!name || name.length > 16) return { error: '名称需为 1-16 个字符' };
    if (!Number.isInteger(number) || number < 0 || number > 999) return { error: '编号需为 0-999 的整数' };
    if (!Number.isFinite(chips) || chips < -1000000 || chips > 10000000) return { error: '初始余额不合法' };
    const key = Store.playerKey(name, number);
    if (this.players[key]) return { error: '该名称和编号已存在' };
    chips = Number.isFinite(chips) ? chips : 1000;
    this.players[key] = {
      name,
      number,
      chips,
      createdAt: Date.now(),
      history: [{ t: Date.now(), room: '', delta: chips, balance: chips, note: '初始发放' }],
    };
    this._savePlayersSoon();
    return { player: this.players[key] };
  }

  // 记一笔余额变动（结算/管理员调整）
  applyDelta(key, delta, room, note) {
    const p = this.players[key];
    if (!p) return null;
    p.chips += Math.round(delta);
    p.history.push({
      t: Date.now(), room: room || '', delta: Math.round(delta), balance: p.chips, note: note || '',
    });
    // 历史只留最近 500 条
    if (p.history.length > 500) p.history = p.history.slice(-500);
    this._savePlayersSoon();
    return p;
  }

  // 大厅展示（不含敏感信息）
  profileOf(key) {
    const p = this.players[key];
    if (!p) return null;
    return { key, name: p.name, number: p.number, chips: p.chips, history: p.history };
  }

  leaderboard(excludeKey) {
    return Object.entries(this.players)
      .filter(([k]) => k !== excludeKey)
      .map(([k, p]) => ({ key: k, name: p.name, number: p.number, chips: p.chips }))
      .sort((a, b) => b.chips - a.chips)
      .slice(0, 50);
  }

  // —— 进行中对局台账（崩溃恢复用）—————————————

  openLedger(roomCode, roomName, startingChips, entries) {
    // entries: [{key, buys, chips}]
    this.active[roomCode] = {
      roomName, startingChips, startedAt: Date.now(),
      players: Object.fromEntries(entries.map(e => [e.key, { buys: e.buys, chips: e.chips }])),
    };
    this._saveActiveSoon();
  }

  updateLedger(roomCode, entries) {
    const l = this.active[roomCode];
    if (!l) return;
    for (const e of entries) {
      if (l.players[e.key]) { l.players[e.key].buys = e.buys; l.players[e.key].chips = e.chips; }
    }
    this._saveActiveSoon();
  }

  closeLedger(roomCode) {
    delete this.active[roomCode];
    this._saveActiveSoon();
  }

  // 启动时把上次未正常关闭的对局按桌上筹码结算（买入次数 × 开局筹码）
  _settleOrphaned() {
    const codes = Object.keys(this.active);
    if (!codes.length) return;
    for (const code of codes) {
      const l = this.active[code];
      const start = l.startingChips ?? 1000;
      for (const [key, s] of Object.entries(l.players)) {
        const delta = s.chips - s.buys * start;
        if (delta !== 0) {
          this.applyDelta(key, delta, l.roomName || code, '服务器重启，按桌面筹码自动结算');
        }
      }
      console.log(`[恢复] 房间 ${code} 有未结算对局，已按桌面筹码自动结算。`);
    }
    this.active = {};
    this._saveActiveSoon();
  }

  // —— 保存（防抖 + 退出兜底）———————————————————

  _savePlayersSoon() { this._debounce('players', () => saveJsonSync('players.json', this.players)); }
  _saveConfig() { saveJsonSync('config.json', this.config); }
  _saveActiveSoon() { this._debounce('active', () => saveJsonSync('active.json', this.active)); }

  _debounce(name, fn) {
    clearTimeout(this._timers.get(name));
    this._timers.set(name, setTimeout(() => {
      this._timers.delete(name);
      try { fn(); } catch (e) { console.error('[存储] 写入失败:', e.message); }
    }, 300));
  }

  flushAll() {
    clearTimeout(this._timers.get('players'));
    clearTimeout(this._timers.get('active'));
    try { saveJsonSync('players.json', this.players); } catch {}
    try { saveJsonSync('active.json', this.active); } catch {}
    try { saveJsonSync('config.json', this.config); } catch {}
  }
}
