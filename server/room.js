// 房间：座位管理、一手牌循环、行动计时、聊天、结算与快照
import { Hand } from './game.js';
import { newToken } from './auth.js';

const SEATS = 9;
const HAND_END_DELAY = 8000;   // 一手结束后自动开下一手的等待
const ROOM_IDLE_TTL = 5 * 60 * 1000; // 无人连接的房间保留时长

const ROOM_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export function newRoomCode(existing) {
  for (;;) {
    let c = '';
    for (let i = 0; i < 6; i++) c += ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)];
    if (!existing.has(c)) return c;
  }
}

const STREET_CN = { preflop: '翻牌前', flop: '翻牌', turn: '转牌', river: '河牌', showdown: '摊牌' };
const CARD_CN = c => c; // 直接用标准记号 As/Kh，前端渲染花色符号

export class Room {
  constructor(hub, code, name, settings, hostKey) {
    this.hub = hub;
    this.store = hub.store;
    this.code = code;
    this.name = name;
    this.settings = {
      startingChips: settings.startingChips || 1000,
      sb: settings.sb || 10,
      bb: settings.bb || 20,
      ante: settings.ante || 0,
      actionTime: settings.actionTime ?? 30, // 秒，0 = 不限时
      rebuys: settings.rebuys !== false,
    };
    this.hostKey = hostKey;
    this.seats = Array(SEATS).fill(null); // {key, name, stack, buys, sittingOut, pendingStand}
    this.spectators = new Set();          // key
    this.names = new Map();               // key → name
    this.hand = null;
    this.phase = 'lobby';                 // lobby | playing | handend | paused
    this.handNo = 0;
    this.buttonSeat = -1;
    this.chat = [];                       // {t, kind:'chat'|'sys', key, name, text}
    this.actionDeadline = null;
    this._actionTimer = null;
    this._nextTimer = null;
    this._logCursor = 0;
    this.lastActive = Date.now();
    this.onDirty = null; // 计时器等自发变更后由 hub 设置的广播回调
  }

  // —— 成员 ——————————————————————————————

  join(key, name) {
    this.names.set(key, name);
    this.spectators.add(key);
    this.sysMsg(`${name} 进入房间`);
  }

  has(key) { return this.names.has(key); }
  seatOf(key) { return this.seats.findIndex(s => s && s.key === key); }

  sit(key, seat) {
    const name = this.names.get(key);
    if (!name) return '你不在这个房间';
    if (this.seatOf(key) >= 0) return '你已经入座了';
    if (this.hand && !this.hand.finished && this.hand.players.some(p => p.key === key)) {
      return '请等本手结束后再入座';
    }
    if (!(seat >= 0 && seat < SEATS)) return '座位不合法';
    if (this.seats[seat]) return '这个座位已有人';
    this.seats[seat] = {
      key, name, stack: this.settings.startingChips, buys: 1,
      sittingOut: false, pendingStand: false,
    };
    this.spectators.delete(key);
    this.sysMsg(`${name} 入座 ${seat + 1} 号位，买入 ${this.settings.startingChips}`);
    this._updateLedger();
    return null;
  }

  stand(key, note = '') {
    const idx = this.seatOf(key);
    if (idx < 0) return '你没有入座';
    const s = this.seats[idx];
    if (this.hand && !this.hand.finished && this.hand.players.some(p => p.key === key && !p.folded)) {
      s.pendingStand = true;
      this.sysMsg(`${s.name} 将在本手结束后离座`);
      return null;
    }
    this._settleSeat(idx, note);
    return null;
  }

  // 结算一个座位：把桌上筹码与买入的差额记入余额，并移出座位
  _settleSeat(idx, note = '') {
    const s = this.seats[idx];
    if (!s) return;
    const delta = s.stack - s.buys * this.settings.startingChips;
    this.store.applyDelta(s.key, delta, this.name, note || `对局结算（${s.buys} 次买入）`);
    this.sysMsg(`${s.name} 离座，本局 ${delta >= 0 ? '+' : ''}${delta}`);
    this.seats[idx] = null;
    this.spectators.add(s.key);
    this._updateLedger();
  }

  rebuy(key) {
    const idx = this.seatOf(key);
    if (idx < 0) return '你没有入座';
    if (!this.settings.rebuys) return '本房间不允许再买入';
    const s = this.seats[idx];
    if (s.stack > 0) return '还有筹码，不需要再买入';
    if (this.hand && !this.hand.finished) return '请等这一手结束后再买入';
    s.stack += this.settings.startingChips;
    s.buys += 1;
    s.sittingOut = false;
    this.sysMsg(`${s.name} 再买入 ${this.settings.startingChips}`);
    this._updateLedger();
    return null;
  }

  // 房主把某个座位结账移除（限两手之间，或该玩家已弃牌/旁观时）
  kick(hostKey, targetKey) {
    if (!this.isHost(hostKey)) return '只有房主可以移除玩家';
    if (targetKey === hostKey) return '不能移除自己，请直接站起';
    const idx = this.seatOf(targetKey);
    if (idx < 0) {
      // 旁观者直接请出
      if (this.names.has(targetKey)) {
        this.sysMsg(`${this.names.get(targetKey)} 被房主请出房间`);
        this.spectators.delete(targetKey);
        this.names.delete(targetKey);
        return null;
      }
      return '该玩家不在房间';
    }
    const inLiveHand = this.hand && !this.hand.finished && this.hand.players.some(p => p.key === targetKey && !p.folded);
    if (inLiveHand) return '该玩家正在这一手中，请等本手结束';
    this._settleSeat(idx, '房主移除结算');
    return null;
  }

  leave(key) {
    const name = this.names.get(key);
    if (!name) return;
    this.stand(key, '离开房间');
    this.spectators.delete(key);
    this.names.delete(key);
    this.sysMsg(`${name} 离开了房间`);
    if (this.hostKey === key) this._migrateHost();
  }

  _migrateHost() {
    const seated = this.seats.find(s => s);
    const any = seated ? seated.key : [...this.names.keys()][0];
    this.hostKey = any || null;
    if (this.hostKey) {
      this.sysMsg(`${this.names.get(this.hostKey)} 成为房主`);
    }
  }

  isHost(key) { return this.hostKey === key; }

  // —— 对局 ——————————————————————————————

  _eligibleSeats() {
    return this.seats
      .map((s, seat) => ({ s, seat }))
      .filter(({ s }) => s && !s.sittingOut && s.stack > 0 && !s.pendingStand);
  }

  startGame(key) {
    if (!this.isHost(key)) return '只有房主可以开始游戏';
    if (this.hand && !this.hand.finished) return '正在对局中';
    if (this._eligibleSeats().length < 2) return '需要至少 2 名有筹码的玩家入座';
    this.phase = 'playing';
    this.store.openLedger(this.code, this.name, this.settings.startingChips,
      this.seats.filter(Boolean).map(s => ({ key: s.key, buys: s.buys, chips: s.stack })));
    this._startHand();
    return null;
  }

  pauseToggle(key) {
    if (!this.isHost(key)) return '只有房主可以暂停';
    if (this.phase === 'playing' || this.phase === 'handend') {
      this.phase = this.phase === 'paused' ? 'handend' : 'paused';
      if (this.phase === 'paused') this._clearNextTimer();
      else this._scheduleNextHand(HAND_END_DELAY);
      return null;
    }
    return '当前无法暂停';
  }

  nextHandNow(key) {
    if (!this.isHost(key)) return '只有房主可以立即开始下一手';
    if (this.phase !== 'handend' && this.phase !== 'paused') return '当前没有在等待下一手';
    this._startHand();
    return null;
  }

  _startHand() {
    this._clearNextTimer();
    const eligible = this._eligibleSeats();
    if (eligible.length < 2) {
      this.phase = 'handend';
      this.sysMsg('人数不足，等待玩家入座或再买入…');
      return;
    }
    this.handNo += 1;
    // 按钮移到下一个参与本手的座位（首手取第一个入座者）
    let btn = this.buttonSeat;
    for (let i = 1; i <= SEATS; i++) {
      const cand = (Math.max(this.buttonSeat, -1) + i) % SEATS;
      if (eligible.some(({ seat }) => seat === cand)) { btn = cand; break; }
    }
    this.buttonSeat = btn;

    const seated = eligible.map(({ s, seat }) => ({ seat, key: s.key, name: s.name, stack: s.stack }));
    this.hand = new Hand(seated, {
      sb: this.settings.sb, bb: this.settings.bb, ante: this.settings.ante,
      buttonSeat: this.buttonSeat, handNo: this.handNo,
    });
    this.phase = 'playing';
    this._logCursor = 0;
    this.sysMsg(`—— 第 ${this.handNo} 手 ——（盲注 ${this.settings.sb}/${this.settings.bb}）`);
    this._syncStacks();
    this._armActionTimer();
  }

  _syncStacks() {
    if (!this.hand) return;
    for (const hp of this.hand.players) {
      const idx = this.seatOf(hp.key);
      if (idx >= 0) this.seats[idx].stack = hp.stack;
    }
  }

  _onHandEnd() {
    this._syncStacks();
    this._clearActionTimer();
    this.actionDeadline = null;
    this.store.updateLedger(this.code, this.seats.filter(Boolean).map(s => ({ key: s.key, buys: s.buys, chips: s.stack })));
    // 处理离座请求
    this.seats.forEach((s, i) => { if (s && s.pendingStand) this._settleSeat(i, '对局结束后离座'); });
    // 房主申请的关闭
    if (this.pendingClose) {
      this.phase = 'handend';
      this.hub._closeRoom(this.code);
      return;
    }
    // 破产玩家
    for (const s of this.seats) {
      if (s && s.stack <= 0) {
        if (this.settings.rebuys) this.sysMsg(`${s.name} 筹码用完，可再买入继续`);
        else { s.sittingOut = true; this.sysMsg(`${s.name} 筹码用完，进入观望`); }
      }
    }
    this.phase = this.phase === 'paused' ? 'paused' : 'handend';
    if (this.phase !== 'paused') this._scheduleNextHand(HAND_END_DELAY);
  }

  _scheduleNextHand(ms) {
    this._clearNextTimer();
    this._nextTimer = setTimeout(() => {
      this._nextTimer = null;
      if (this.phase === 'handend') {
        this._startHand();
        this.onDirty?.();
      }
    }, ms);
    this._nextTimer.unref?.();
  }

  _clearNextTimer() { if (this._nextTimer) { clearTimeout(this._nextTimer); this._nextTimer = null; } }

  // —— 行动 ——————————————————————————————

  act(key, action, to) {
    if (!this.hand || this.hand.finished) return '当前没有进行中的手牌';
    const legal = this.hand.legalActions(key);
    if (!legal) return '现在轮不到你行动';
    const err = this.hand.act(key, action, to);
    if (err) return err;
    this._syncStacks();
    if (this.hand.finished) this._onHandEnd();
    else this._armActionTimer();
    return null;
  }

  _armActionTimer() {
    this._clearActionTimer();
    this.actionDeadline = null;
    const t = this.settings.actionTime;
    if (!t || !this.hand || this.hand.finished || !this.hand.toActKey) return;
    this.actionDeadline = Date.now() + t * 1000;
    this._actionTimer = setTimeout(() => {
      this._actionTimer = null;
      const key = this.hand && !this.hand.finished ? this.hand.toActKey : null;
      if (!key || !this.actionDeadline) return;
      const legal = this.hand.legalActions(key);
      if (!legal) return;
      // 超时动作由引擎日志记录（弃牌/过牌），这里不重复播报
      this.act(key, legal.canCheck ? 'check' : 'fold');
      this.onDirty?.();
    }, t * 1000 + 200);
    this._actionTimer.unref?.();
  }

  _clearActionTimer() { if (this._actionTimer) { clearTimeout(this._actionTimer); this._actionTimer = null; } }

  // —— 聊天 ——————————————————————————————

  chatMsg(key, text) {
    const name = this.names.get(key);
    if (!name) return;
    text = String(text).slice(0, 300).trim();
    if (!text) return;
    this._pushChat({ t: Date.now(), kind: 'chat', key, name, text });
  }

  sysMsg(text) {
    this._pushChat({ t: Date.now(), kind: 'sys', name: '', text });
  }

  _pushChat(entry) {
    this.chat.push(entry);
    if (this.chat.length > 80) this.chat = this.chat.slice(-80);
  }

  // 把引擎日志转成系统消息（增量）
  _flushLog() {
    if (!this.hand) return;
    const log = this.hand.log;
    while (this._logCursor < log.length) {
      const e = log[this._logCursor++];
      switch (e.type) {
        case 'blinds':
          this.sysMsg(`${e.sb.name} 小盲 ${e.sb.amount}，${e.bb.name} 大盲 ${e.bb.amount}`);
          break;
        case 'antes':
          this.sysMsg(`前注：${e.players.map(p => `${p.name} ${p.amount}`).join('，')}`);
          break;
        case 'action': {
          const A = { fold: '弃牌', check: '过牌', call: `跟注 ${e.amount ?? ''}`, bet: `下注 ${e.amount}`, raise: `加注到 ${e.amount}`, 'allin-call': `全下跟注 ${e.amount}`, 'allin-bet': `全下 ${e.amount}`, 'allin-raise': `全下加注 ${e.amount}` };
          this.sysMsg(`${e.name} ${A[e.action] ?? e.action}`);
          break;
        }
        case 'street': {
          if (e.street === 'showdown') break; // 摊牌由 reveal/showdown 事件描述
          const cards = (e.street === 'flop' ? e.cards.slice(-3) : e.cards.slice(-1)).map(CARD_CN).join(' ');
          this.sysMsg(`${STREET_CN[e.street]}：${cards}`);
          break;
        }
        case 'refund':
          this.sysMsg(`未被跟注的 ${e.amount} 退还给 ${e.name}`);
          break;
        case 'foldwin':
          this.sysMsg(`【${e.name} 收下彩池 ${e.amount}】`);
          break;
        case 'showdown': {
          for (const p of e.players) this.sysMsg(`${p.name} 亮牌 ${p.cards.join(' ')}（${p.hand}）`);
          break;
        }
        case 'reveal':
          for (const p of e.players) this.sysMsg(`${p.name} 亮牌 ${p.cards.join(' ')}`);
          break;
        default:
          break;
      }
    }
  }

  // —— 台账 ——————————————————————————————

  _updateLedger() {
    const entries = this.seats.filter(Boolean).map(s => ({ key: s.key, buys: s.buys, chips: s.stack }));
    if (entries.length) this.store.updateLedger(this.code, entries);
  }

  // —— 广播与快照 ——————————————————————————————

  broadcast() {
    this._flushLog();
    for (const conn of this.hub.connsInRoom(this.code)) {
      this.hub.sendTo(conn, { type: 'room', room: this.snapshotFor(conn.key) });
    }
  }

  // 座位在客户端的展示顺序：把"我"固定在 6 点钟方向
  snapshotFor(key) {
    const handView = this.hand ? this.hand.view() : null;
    const mySeatIdx = this.seatOf(key);
    const meInHand = mySeatIdx >= 0 && this.hand && this.hand.players.some(p => p.key === key);
    const myHole = meInHand ? this.hand.holeOf(key) : [];
    const myLegal = (!this.hand || this.hand.finished || this.hand.toActKey !== key) ? null : this.hand.legalActions(key);

    const seats = this.seats.map((s, i) => {
      if (!s) return null;
      const hp = this.hand?.players.find(p => p.key === s.key);
      return {
        seat: i, key: s.key, name: s.name,
        number: Number(s.key.split('#')[1]) || 0,
        stack: s.stack, buys: s.buys,
        sittingOut: s.sittingOut, pendingStand: s.pendingStand,
        connected: this.hub.isConnected(s.key),
        isHost: s.key === this.hostKey,
        isMe: s.key === key,
        inHand: !!hp,
        folded: hp ? hp.folded : false,
        allIn: hp ? hp.allIn : false,
        bet: hp ? hp.bet : 0,
        lastAction: hp ? hp.lastAction : null,
        isButton: !!(handView && handView.players.find(p => p.key === s.key)?.isButton),
        hole: (handView && handView.revealed && hp && !hp.folded) ? this.hand.holeOf(s.key) : null,
      };
    });

    return {
      code: this.code,
      name: this.name,
      settings: this.settings,
      phase: this.phase,
      handNo: this.handNo,
      buttonSeat: this.buttonSeat,
      hostKey: this.hostKey,
      seats,
      spectators: [...this.spectators].map(k => ({ key: k, name: this.names.get(k) || '?', isMe: k === key })),
      hand: handView ? {
        street: handView.street,
        board: handView.board,
        pot: handView.pot,
        currentBet: handView.currentBet,
        toActKey: handView.toActKey,
        finished: handView.finished,
        showdown: handView.showdown,
      } : null,
      myHole,
      myLegal,
      actionDeadline: this.actionDeadline,
      serverTime: Date.now(),
      chat: this.chat,
      inHand: meInHand,
      mySeat: mySeatIdx,
      canRebuy: (() => {
        if (mySeatIdx < 0) return false;
        const s = this.seats[mySeatIdx];
        return this.settings.rebuys && s.stack <= 0 && !(this.hand && !this.hand.finished && this.hand.players.some(p => p.key === key && !p.folded));
      })(),
    };
  }

  // 房主结束房间：本手进行中则等打完这一手再关
  requestClose(key) {
    if (!this.isHost(key)) return '只有房主可以结束房间';
    if (this.hand && !this.hand.finished) {
      this.pendingClose = true;
      this.sysMsg('房主已申请结束房间，本手打完后将结算关闭');
      return null;
    }
    this.hub._closeRoom(this.code);
    return null;
  }

  // 空房回收
  isEmpty() { return this.names.size === 0; }
  hasConnections() { return this.hub.connsInRoom(this.code).length > 0; }
  idleMs() { return Date.now() - this.lastActive; }

  close() {
    this._clearActionTimer();
    this._clearNextTimer();
    // 结算所有座位；若本手仍在进行，按"剩余筹码 + 本轮下注"结算
    this.seats.forEach((s, i) => {
      if (!s) return;
      let eff = s.stack;
      const hp = this.hand && !this.hand.finished ? this.hand.players.find(p => p.key === s.key) : null;
      if (hp) eff = hp.stack + hp.bet;
      const delta = eff - s.buys * this.settings.startingChips;
      this.store.applyDelta(s.key, delta, this.name, '房间关闭结算');
      this.seats[i] = null;
    });
    this.store.closeLedger(this.code);
  }
}
