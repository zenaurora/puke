// 一手牌的引擎：官方无限注德州扑克规则
// 盲注/前注、四轮下注、最小加注、不足额全下不重开加注权、边池分层、平分与零头、退还未被跟注部分
import { newDeck, shuffle } from './cards.js';
import { evaluate7, handName, cmpEval } from './evaluator.js';

const STREET_ORDER = ['preflop', 'flop', 'turn', 'river', 'showdown'];
const SEAT_MOD = 9; // 固定 9 个座位

export class Hand {
  // seated: [{seat, key, name, stack}]（已按座位排序、均有筹码）
  // opts: {sb, bb, ante, buttonSeat, handNo}
  // deck: 可注入有序牌堆用于测试；发牌顺序：按座位序每人两张，随后翻牌3张、转牌/河牌各1张
  constructor(seated, opts, deck) {
    this.sb = opts.sb;
    this.bb = opts.bb;
    this.ante = opts.ante || 0;
    this.buttonSeat = opts.buttonSeat;
    this.handNo = opts.handNo || 1;
    this.deck = deck ? [...deck] : shuffle(newDeck());
    this.board = [];
    this.street = 'preflop';
    this.finished = false;
    this.revealed = false; // 全下摊牌，底牌已亮
    this.log = [];
    this.results = [];
    this.currentBet = 0;
    this.minRaiseSize = this.bb;
    this.toActKey = null;
    this.players = seated.map(p => ({
      seat: p.seat, key: p.key, name: p.name, stack: p.stack,
      hole: [], bet: 0, contrib: 0, folded: false, allIn: false,
      acted: false, raiseBlocked: false, lastAction: null,
    }));
    this._start();
  }

  // —— 工具 ——————————————————————————————

  // 从 fromSeat 顺时针找下一个满足条件的玩家
  _nextFrom(fromSeat, pred) {
    for (let i = 1; i <= SEAT_MOD; i++) {
      const seat = (fromSeat + i) % SEAT_MOD;
      const p = this.players.find(x => x.seat === seat);
      if (p && pred(p)) return p;
    }
    return null;
  }

  _unfolded() { return this.players.filter(p => !p.folded); }
  _eligible() { return this.players.filter(p => !p.folded && !p.allIn); }

  _roundDone() {
    const el = this._eligible();
    if (el.length === 0) return true;
    return el.every(p => p.acted && p.bet === this.currentBet);
  }

  _pay(p, amount) {
    const actual = Math.min(amount, p.stack);
    p.stack -= actual;
    p.bet += actual;
    p.contrib += actual;
    if (p.stack === 0) p.allIn = true;
    return actual;
  }

  // —— 开局 ——————————————————————————————

  _start() {
    // 前注：直接进底池，不计入本轮下注额
    if (this.ante > 0) {
      const antes = [];
      for (const p of this.players) {
        const paid = Math.min(this.ante, p.stack);
        p.stack -= paid;
        p.contrib += paid;
        if (p.stack === 0) p.allIn = true;
        if (paid > 0) antes.push({ key: p.key, name: p.name, amount: paid });
      }
      this.log.push({ type: 'antes', players: antes });
    }

    // 盲注位：两人局按钮即小盲；三人及以上按钮下一位小盲、再下一位大盲
    if (this.players.length === 2) {
      this.sbSeat = this.buttonSeat;
      this.bbSeat = this._nextFrom(this.buttonSeat, () => true).seat;
    } else {
      this.sbSeat = this._nextFrom(this.buttonSeat, () => true).seat;
      this.bbSeat = this._nextFrom(this.sbSeat, () => true).seat;
    }
    const sbP = this.players.find(p => p.seat === this.sbSeat);
    const bbP = this.players.find(p => p.seat === this.bbSeat);
    const sbPaid = this._pay(sbP, this.sb);
    const bbPaid = this._pay(bbP, this.bb);
    this.currentBet = this.bb;
    this.minRaiseSize = this.bb;
    this.log.push({ type: 'blinds', sb: { key: sbP.key, name: sbP.name, amount: sbPaid }, bb: { key: bbP.key, name: bbP.name, amount: bbPaid } });

    // 发底牌
    for (const p of this.players) p.hole = [this.deck.pop(), this.deck.pop()];
    this.log.push({ type: 'deal' });

    // 翻牌前首先行动：两人局为按钮/小盲；否则大盲下一位（UTG）
    let first;
    if (this.players.length === 2) first = [sbP, bbP].find(p => !p.allIn);
    else first = this._nextFrom(this.bbSeat, p => !p.folded && !p.allIn);
    if (first) this.toActKey = first.key;
    else this._nextStreet(); // 极端情况：盲注后全员全下
  }

  // —— 合法行动 ——————————————————————————————

  legalActions(key) {
    const p = this.players.find(x => x.key === key);
    if (!p || this.finished || this.toActKey !== key || p.folded || p.allIn) return null;
    const toCall = this.currentBet - p.bet;
    const maxTo = p.bet + p.stack;
    const res = {
      toCall: Math.min(toCall, p.stack),
      canFold: true,
      canCheck: toCall === 0,
      canCall: toCall > 0,
      canBet: false, canRaise: false,
      minTo: 0, maxTo,
    };
    if (this.currentBet === 0) {
      if (p.stack > 0) {
        res.canBet = true;
        res.minTo = Math.min(this.bb, maxTo); // 不足大盲的全下也允许
        res.maxTo = maxTo;
      }
    } else {
      const minTo = Math.min(this.currentBet + this.minRaiseSize, maxTo);
      res.minTo = minTo;
      res.canRaise = !p.raiseBlocked && p.stack > 0 && maxTo > this.currentBet;
    }
    return res;
  }

  // —— 行动 ——————————————————————————————

  // type: fold | check | call | bet | raise | allin
  // to: bet/raise 的目标总额（该玩家本轮下注总额）
  act(key, type, to) {
    const legal = this.legalActions(key);
    if (!legal) return '现在轮不到你行动';
    const p = this.players.find(x => x.key === key);
    const toCall = this.currentBet - p.bet;

    if (type === 'allin') {
      // 解析为具体行动
      if (toCall > 0 && p.stack <= toCall) type = 'call';
      else if (toCall > 0) type = 'raise';
      else if (this.currentBet === 0) type = 'bet';
      else type = 'raise';
      to = p.bet + p.stack;
    }

    let err = null;
    if (type === 'fold') {
      p.folded = true;
      p.lastAction = { type: 'fold' };
      this.log.push({ type: 'action', key, name: p.name, action: 'fold' });
    } else if (type === 'check') {
      if (!legal.canCheck) return '当前有人下注，不能过牌';
      p.lastAction = { type: 'check' };
      this.log.push({ type: 'action', key, name: p.name, action: 'check' });
    } else if (type === 'call') {
      if (!legal.canCall) return '无需跟注';
      const paid = this._pay(p, toCall);
      p.lastAction = { type: p.allIn ? 'allin' : 'call', amount: paid };
      this.log.push({ type: 'action', key, name: p.name, action: p.allIn ? 'allin-call' : 'call', amount: paid });
    } else if (type === 'bet') {
      if (!legal.canBet) return '不能下注';
      if (!Number.isInteger(to) || to <= 0 || to > p.bet + p.stack) return '下注额度不合法';
      const full = to >= this.bb;
      if (!full && to !== p.bet + p.stack) return '下注不足大盲时只能全下';
      const paid = this._pay(p, to - p.bet);
      if (full) {
        this.currentBet = to;
        this.minRaiseSize = to; // 加注须至少等于本次下注额
        for (const o of this.players) if (o !== p && !o.folded && !o.allIn) { o.acted = false; o.raiseBlocked = false; }
      } else {
        this.currentBet = Math.max(this.currentBet, to);
        for (const o of this.players) if (o !== p && !o.folded && !o.allIn && o.bet < this.currentBet) o.acted = false;
      }
      p.lastAction = { type: p.allIn ? 'allin' : 'bet', amount: to };
      this.log.push({ type: 'action', key, name: p.name, action: p.allIn ? 'allin-bet' : 'bet', amount: to });
    } else if (type === 'raise') {
      if (!legal.canRaise) return '不能加注';
      if (!Number.isInteger(to) || to <= this.currentBet || to > p.bet + p.stack) return '加注额度不合法';
      const full = to - this.currentBet >= this.minRaiseSize;
      if (!full && to !== p.bet + p.stack) return '加注幅度不足时只能全下';
      const prevBet = this.currentBet;
      this._pay(p, to - p.bet);
      if (full) {
        this.minRaiseSize = to - prevBet;
        for (const o of this.players) if (o !== p && !o.folded && !o.allIn) { o.acted = false; o.raiseBlocked = false; }
      } else {
        // 不足额全下：不更新最小加注额，也不恢复已行动玩家的加注权
        for (const o of this.players) if (o !== p && !o.folded && !o.allIn && o.bet < to) o.acted = false;
      }
      this.currentBet = to;
      p.lastAction = { type: p.allIn ? 'allin' : 'raise', amount: to };
      this.log.push({ type: 'action', key, name: p.name, action: p.allIn ? 'allin-raise' : 'raise', amount: to });
    } else {
      return '未知行动';
    }

    p.acted = true;
    p.raiseBlocked = true;
    this._advance(p);
    return null;
  }

  _advance(actor) {
    if (this.finished) return;
    if (this._unfolded().length === 1) return this._finishFoldWin();
    if (this._roundDone()) return this._nextStreet();
    const next = this._nextFrom(actor.seat, p => !p.folded && !p.allIn);
    if (!next) return this._nextStreet();
    this.toActKey = next.key;
  }

  // —— 进入下一街 ——————————————————————————————

  _nextStreet() {
    for (const p of this.players) { p.bet = 0; p.acted = false; p.raiseBlocked = false; p.lastAction = null; }
    this.currentBet = 0;
    this.minRaiseSize = this.bb;
    this.toActKey = null;

    this._enterStreet();
    if (this.street === 'showdown') return this._showdown();

    if (this._eligible().length < 2) {
      // 全下摊牌：亮牌并把公共牌发完
      this.revealed = true;
      this.log.push({ type: 'reveal', players: this._unfolded().map(p => ({ key: p.key, name: p.name, cards: [...p.hole] })) });
      while (this.street !== 'showdown') this._enterStreet();
      return this._showdown();
    }

    // 翻牌后首先行动：按钮顺时针下一位可行动玩家（两人局为大盲）
    const first = this._nextFrom(this.buttonSeat, p => !p.folded && !p.allIn);
    this.toActKey = first.key;
  }

  _enterStreet() {
    this.street = STREET_ORDER[STREET_ORDER.indexOf(this.street) + 1];
    if (this.street === 'flop') this.board.push(this.deck.pop(), this.deck.pop(), this.deck.pop());
    else if (this.street !== 'showdown') this.board.push(this.deck.pop());
    this.log.push({ type: 'street', street: this.street, cards: [...this.board] });
  }

  // —— 结算 ——————————————————————————————

  // 把未被跟注的部分退还给最大贡献者（金额高于其余所有人时）
  _refundUncalled() {
    const sorted = [...this.players].sort((a, b) => b.contrib - a.contrib);
    if (sorted.length >= 2 && sorted[0].contrib > sorted[1].contrib) {
      const back = sorted[0].contrib - sorted[1].contrib;
      sorted[0].contrib -= back;
      sorted[0].stack += back;
      this.log.push({ type: 'refund', key: sorted[0].key, name: sorted[0].name, amount: back });
    }
  }

  _finishFoldWin() {
    this._refundUncalled();
    const winner = this._unfolded()[0];
    const amount = this.players.reduce((s, p) => s + p.contrib, 0);
    winner.stack += amount;
    for (const p of this.players) p.contrib = 0;
    this.finished = true;
    this.toActKey = null;
    this.results = [{ amount, winners: [{ key: winner.key, name: winner.name, amount, hand: null }] }];
    this.log.push({ type: 'foldwin', key: winner.key, name: winner.name, amount });
    this.log.push({ type: 'handend', handNo: this.handNo });
  }

  _showdown() {
    this._refundUncalled();
    const unfolded = this._unfolded();
    const evals = new Map();
    for (const p of unfolded) {
      const ev = evaluate7([...p.hole, ...this.board]);
      evals.set(p.key, ev);
    }

    // 按贡献额分层构建边池
    const levels = [...new Set(this.players.filter(p => p.contrib > 0).map(p => p.contrib))].sort((a, b) => a - b);
    let prev = 0;
    for (const L of levels) {
      let amount = 0;
      for (const p of this.players) amount += Math.max(0, Math.min(p.contrib, L) - prev);
      prev = L;
      if (amount === 0) continue;
      const eligible = unfolded.filter(p => p.contrib >= L);
      if (eligible.length === 0) continue;
      const best = eligible.reduce((m, p) => cmpEval(evals.get(p.key), evals.get(m.key)) > 0 ? p : m);
      const winners = eligible.filter(p => cmpEval(evals.get(p.key), evals.get(best.key)) === 0);
      // 平分；零头按按钮顺时针顺序发给前面的赢家
      const ordered = [...winners].sort((a, b) =>
        ((a.seat - this.buttonSeat + SEAT_MOD) % SEAT_MOD) - ((b.seat - this.buttonSeat + SEAT_MOD) % SEAT_MOD));
      const base = Math.floor(amount / ordered.length);
      const rem = amount - base * ordered.length;
      const shares = ordered.map((_, i) => base + (i < rem ? 1 : 0));
      ordered.forEach((w, i) => { w.stack += shares[i]; });
      this.results.push({
        amount, layer: L,
        winners: ordered.map((x, i) => ({
          key: x.key, name: x.name, amount: shares[i],
          hand: handName(evals.get(x.key)),
          cards: [...x.hole],
        })),
      });
    }
    // 赢家集合相同的相邻层合并为一条结果（如前注死钱与主池同归赢家）
    const merged = new Map();
    for (const r of this.results) {
      const sig = r.winners.map(w => w.key).sort().join('|');
      if (merged.has(sig)) {
        const m = merged.get(sig);
        m.amount += r.amount;
        for (const w of r.winners) {
          const mw = m.winners.find(x => x.key === w.key);
          if (mw) mw.amount += w.amount;
        }
      } else merged.set(sig, r);
    }
    this.results = [...merged.values()].sort((a, b) => a.layer - b.layer);
    for (const p of this.players) p.contrib = 0;

    this.revealed = true;
    this.finished = true;
    this.toActKey = null;
    this.log.push({ type: 'showdown', players: unfolded.map(p => ({ key: p.key, name: p.name, cards: [...p.hole], hand: handName(evals.get(p.key)) })) });
    this.log.push({ type: 'handend', handNo: this.handNo });
  }

  // —— 视图 ——————————————————————————————

  // 公共视图（不含任何底牌，除已亮牌的）
  view() {
    return {
      handNo: this.handNo,
      street: this.street,
      board: [...this.board],
      pot: this.players.reduce((s, p) => s + p.contrib, 0),
      streetBets: this.players.reduce((s, p) => s + p.bet, 0),
      currentBet: this.currentBet,
      toActKey: this.finished ? null : this.toActKey,
      revealed: this.revealed,
      finished: this.finished,
      players: this.players.map(p => ({
        key: p.key, name: p.name, seat: p.seat, stack: p.stack,
        bet: p.bet, folded: p.folded, allIn: p.allIn,
        lastAction: p.lastAction,
        isButton: p.seat === this.buttonSeat,
        isSB: p.seat === this.sbSeat,
        isBB: p.seat === this.bbSeat,
      })),
      showdown: (this.revealed || this.finished)
        ? {
            results: this.results,
            reveals: this._unfolded().map(p => ({ key: p.key, name: p.name, cards: [...p.hole] })),
          }
        : null,
    };
  }

  holeOf(key) {
    const p = this.players.find(x => x.key === key);
    return p ? [...p.hole] : [];
  }
}
