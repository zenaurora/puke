import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hand } from '../game.js';

// players: [['A',0,1000], ...] → 按座位排序
function mkPlayers(defs) {
  return defs.map(([key, seat, stack]) => ({ key, name: key, seat, stack }))
    .sort((a, b) => a.seat - b.seat);
}

// 构造有序牌堆：holes 按玩家顺序，之后翻牌/转牌/河牌
function deckFor(holes, flop = [], turn = null, river = null) {
  const d = [];
  if (river) d.push(river);
  if (turn) d.push(turn);
  d.push(...flop);
  for (let i = holes.length - 1; i >= 0; i--) d.push(...holes[i]);
  return d;
}

const stacks = h => Object.fromEntries(h.players.map(p => [p.key, p.stack]));

test('盲注与行动顺序（3人）', () => {
  const h = new Hand(mkPlayers([['A', 0, 1000], ['B', 1, 1000], ['C', 2, 1000]]), { sb: 10, bb: 20, buttonSeat: 0 });
  assert.equal(h.toActKey, 'A', '按钮下家小盲、再下家大盲，UTG 即按钮本人');
  const A = h.players.find(p => p.key === 'A'), B = h.players.find(p => p.key === 'B'), C = h.players.find(p => p.key === 'C');
  assert.equal(A.isButton ?? true, true);
  assert.equal(h.players.find(p => p.seat === h.sbSeat).key, 'B');
  assert.equal(h.players.find(p => p.seat === h.bbSeat).key, 'C');
  assert.equal(B.bet, 10); assert.equal(C.bet, 20);
  assert.equal(h.currentBet, 20);

  const legal = h.legalActions('A');
  assert.equal(legal.toCall, 20);
  assert.equal(legal.canRaise, true);
  assert.equal(legal.minTo, 40, '最小加注到 2 个大盲');

  assert.equal(h.act('A', 'raise', 60), null);
  assert.equal(h.act('B', 'fold'), null);
  assert.equal(h.act('C', 'call'), null);
  assert.equal(h.street, 'flop');
  assert.equal(h.toActKey, 'C', '翻牌后按钮下家先行动（B 已弃牌则顺延）');
  assert.equal(h.act('C', 'check'), null);
  assert.equal(h.act('A', 'check'), null);
  assert.equal(h.street, 'turn');
});

test('两人局：按钮即小盲，翻牌前按钮先行动，翻牌后大盲先行动', () => {
  const h = new Hand(mkPlayers([['A', 0, 1000], ['B', 3, 1000]]), { sb: 10, bb: 20, buttonSeat: 0 });
  assert.equal(h.players.find(p => p.seat === h.sbSeat).key, 'A');
  assert.equal(h.toActKey, 'A');
  h.act('A', 'call');
  h.act('B', 'check');
  assert.equal(h.street, 'flop');
  assert.equal(h.toActKey, 'B');
});

test('最小加注幅度规则', () => {
  const h = new Hand(mkPlayers([['A', 0, 2000], ['B', 1, 2000], ['C', 2, 2000]]), { sb: 10, bb: 20, buttonSeat: 2 });
  // 按钮 C，小盲 A，大盲 B，UTG C
  h.act('C', 'call'); h.act('A', 'call'); h.act('B', 'check');
  assert.equal(h.street, 'flop');
  // A 下注 200 → 最小加注额 200 → B 加注到 600（幅度 400）→ C 弃牌 → A 再加注至少到 1000
  h.act('A', 'bet', 200);
  h.act('B', 'raise', 600);
  h.act('C', 'fold');
  const legal = h.legalActions('A');
  assert.equal(legal.minTo, 1000);
  assert.ok(h.act('A', 'raise', 800) !== null, '幅度不足 400 应被拒绝');
  assert.equal(h.act('A', 'raise', 1000), null);
});

test('不足额全下不重开已行动玩家的加注权（但未行动者不受影响）', () => {
  const h = new Hand(mkPlayers([['A', 0, 1000], ['B', 1, 350], ['C', 2, 1000]]), { sb: 10, bb: 20, buttonSeat: 0 });
  h.act('A', 'raise', 200);           // 幅度 180，minRaiseSize=180
  assert.equal(h.act('B', 'allin'), null); // B 全下 350，幅度 150 < 180，不足额全下
  const c = h.legalActions('C');
  assert.equal(c.canRaise, true, 'C 尚未行动，仍可加注');
  assert.equal(c.minTo, 530, 'C 的最小加注到 = 350 + 180');
  h.act('C', 'call');
  const a = h.legalActions('A');
  assert.equal(a.toCall, 150);
  assert.equal(a.canCall, true);
  assert.equal(a.canRaise, false, 'A 已行动过，面对不足额全下不能再加注');
});

test('足额加注会重开加注权', () => {
  const h = new Hand(mkPlayers([['A', 0, 1000], ['B', 1, 600], ['C', 2, 1000]]), { sb: 10, bb: 20, buttonSeat: 0 });
  h.act('A', 'raise', 200);
  assert.equal(h.act('B', 'allin'), null); // 600，幅度 400 ≥ 180，足额
  h.act('C', 'fold');
  const a = h.legalActions('A');
  assert.equal(a.canRaise, true);
  assert.equal(a.minTo, 1000, 'A 只能全下加注');
});

test('全下后自动发完公共牌并摊牌（runout）', () => {
  const holes = [['As', 'Ad'], ['Ks', 'Kd'], ['Qs', 'Qd']];
  const deck = deckFor(holes, ['2s', '7h', 'Jc'], '3d', '8c');
  const h = new Hand(mkPlayers([['A', 0, 100], ['B', 1, 300], ['C', 2, 1000]]), { sb: 10, bb: 20, buttonSeat: 0 }, deck);
  h.act('A', 'call');      // A 跟 20，剩 80
  h.act('B', 'call');      // B 补 10，共 20，剩 280
  h.act('C', 'check');
  assert.equal(h.street, 'flop');
  // B 首先行动（按钮 A 的下一位），全下 280；C 跟注；A 全下 80
  h.act('B', 'allin');
  h.act('C', 'call');
  h.act('A', 'allin');     // 只够跟 80，全下跟注
  assert.equal(h.finished, true);
  assert.equal(h.street, 'showdown');
  assert.equal(h.board.length, 5);
  assert.equal(h.revealed, true);
  // 边池：A 100 层三人 300；B/C 300 层 400 由 K 胜 Q
  const s = stacks(h);
  assert.equal(s.A, 300, 'A 赢主池 300');
  assert.equal(s.B, 400, 'B 赢边池 400');
  assert.equal(s.C, 700, 'C 输掉 300');
  assert.equal(h.results.length, 2);
});

test('弃牌获胜：未被跟注部分退还', () => {
  const holes = [['5s', '6s'], ['5h', '6h'], ['5d', '6d']];
  const deck = deckFor(holes, ['2s', '7h', 'Jc'], '3d', '8c');
  const h = new Hand(mkPlayers([['A', 0, 1000], ['B', 1, 1000], ['C', 2, 1000]]), { sb: 10, bb: 20, buttonSeat: 0 }, deck);
  h.act('A', 'call'); h.act('B', 'fold'); h.act('C', 'check');
  assert.equal(h.street, 'flop');
  h.act('C', 'check');
  h.act('A', 'bet', 500);
  h.act('C', 'fold');
  assert.equal(h.finished, true);
  const s = stacks(h);
  assert.equal(s.A, 1030, 'A 拿回未被跟注的 500 后赢下 50 彩池');
  assert.equal(s.B, 990);
  assert.equal(s.C, 980);
});

test('平分彩池与零头筹码（按按钮顺时针）', () => {
  const holes = [['2c', '4c'], ['2d', '4d'], ['7s', '8s']];
  const deck = deckFor(holes, ['Ac', 'Kd', 'Qh'], 'Js', 'Ts');
  const h = new Hand(mkPlayers([['A', 0, 1000], ['B', 1, 1000], ['C', 2, 1000]]), { sb: 10, bb: 20, ante: 3, buttonSeat: 2 }, deck);
  // 按钮 C，小盲 A，大盲 B，UTG C
  h.act('C', 'fold');      // C 只贡献前注 3
  h.act('A', 'call');
  h.act('B', 'check');
  for (const street of ['flop', 'turn', 'river']) {
    h.act('A', 'check'); h.act('B', 'check');
  }
  assert.equal(h.finished, true);
  // 总池 49（A 23 + B 23 + C 3），两人打平：A（按钮后更近）得 25，B 得 24
  const s = stacks(h);
  assert.equal(s.A, 1002);
  assert.equal(s.B, 1001);
  assert.equal(s.C, 997);
  assert.equal(h.results.length, 1);
  assert.equal(h.results[0].winners.length, 2);
});

test('筹码守恒', () => {
  const holes = [['9h', '9d'], ['Ah', 'Kd'], ['2s', '7c']];
  const deck = deckFor(holes, ['Jc', '4d', '8s'], 'Ts', '3c');
  const h = new Hand(mkPlayers([['A', 0, 500], ['B', 4, 500], ['C', 8, 500]]), { sb: 25, bb: 50, buttonSeat: 8 }, deck);
  // 按钮 C，小盲 A，大盲 B，UTG C
  h.act('C', 'fold');
  h.act('A', 'raise', 150);
  h.act('B', 'allin');
  h.act('A', 'call');
  assert.equal(h.finished, true);
  const total = h.players.reduce((s, p) => s + p.stack, 0);
  assert.equal(total, 1500);
});

test('行动轮次与合法性校验', () => {
  const h = new Hand(mkPlayers([['A', 0, 1000], ['B', 1, 1000], ['C', 2, 1000]]), { sb: 10, bb: 20, buttonSeat: 0 });
  assert.ok(h.act('B', 'call') !== null, '没轮到 B 时不能行动');
  assert.ok(h.act('A', 'check') !== null, '有人下注时不能过牌');
  assert.ok(h.act('A', 'raise', 15) !== null, '加注不能低于当前下注');
  assert.equal(h.legalActions('B'), null, '非行动者无合法行动');
  h.act('A', 'fold'); h.act('B', 'fold');
  assert.equal(h.finished, true, '只剩一人立即结束');
  const s = stacks(h);
  assert.equal(s.C, 1010, '大盲赢下小盲的 10（UTG 未投入）');
});
