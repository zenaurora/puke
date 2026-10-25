import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate7, handName, cmpEval } from '../evaluator.js';

const ev = cards => evaluate7(cards);

test('皇家同花顺', () => {
  const r = ev(['As', 'Ks', 'Qs', 'Js', 'Ts', '2h', '3d']);
  assert.equal(r.cat, 8);
  assert.equal(handName(r), '皇家同花顺');
});

test('同花顺与普通顺子区分', () => {
  const sf = ev(['9h', '8h', '7h', '6h', '5h', '2c', '3d']);
  assert.equal(sf.cat, 8);
  const st = ev(['9h', '8c', '7d', '6s', '5h', '2c', '3d']);
  assert.equal(st.cat, 4);
  assert.equal(handName(st), '顺子（9 高）');
});

test('轮子 A2345 是 5 高顺子', () => {
  const wheel = ev(['Ah', '2c', '3d', '4s', '5h', 'Kc', 'Qd']);
  assert.equal(wheel.cat, 4);
  assert.equal(wheel.tb[0], 3); // 5 的点数索引
  const broadway = ev(['Ah', 'Kc', 'Qd', 'Js', 'Ts', '2c', '3d']);
  assert.equal(broadway.cat, 4);
  assert.ok(cmpEval(broadway, wheel) > 0);
});

test('四条与踢脚', () => {
  const q = ev(['7h', '7d', '7s', '7c', 'Kd', '2c', '3h']);
  assert.equal(q.cat, 7);
  assert.equal(q.tb[1], 11); // 踢脚 K
});

test('葫芦按三条再按对子比较', () => {
  const a = ev(['9h', '9d', '9s', '4c', '4d', '2c', '3h']); // 999 44
  const b = ev(['8h', '8d', '8s', 'Ac', 'Ad', '2c', '3h']); // 888 AA
  assert.equal(a.cat, 6); assert.equal(b.cat, 6);
  assert.ok(cmpEval(a, b) > 0);
});

test('同花比高牌', () => {
  const f = ev(['Ah', '9h', '6h', '4h', '2h', 'Kc', 'Qd']);
  assert.equal(f.cat, 5);
});

test('两对与第二踢脚', () => {
  const a = ev(['Ah', 'Ad', '9c', '9d', 'Ks', '2c', '3h']); // AA 99 K
  const b = ev(['Ah', 'Ad', '9c', '9d', 'Qs', '2c', '3h']); // AA 99 Q
  assert.equal(a.cat, 2); assert.equal(b.cat, 2);
  assert.ok(cmpEval(a, b) > 0);
});

test('一对按对子再按踢脚', () => {
  const a = ev(['Th', 'Td', 'Ac', '7d', '5s', '2c', '3h']);
  const b = ev(['Jh', 'Jd', '2c', '3d', '4s', '5c', '6h']);
  assert.ok(cmpEval(b, a) > 0, 'JJ > TT');
  const c = ev(['Th', 'Td', 'Ac', '7d', '5s', '2c', '3h']);
  const d = ev(['Th', 'Td', 'Kc', '7d', '5s', '2c', '3h']);
  assert.ok(cmpEval(c, d) > 0, '踢脚 A > K');
});

test('牌面完全相同则平分', () => {
  const a = ev(['Ah', 'Kd', '9c', '7d', '5s', '2c', '3h']);
  const b = ev(['As', 'Kh', '9d', '7c', '5h', '2d', '3s']);
  assert.equal(cmpEval(a, b), 0);
});

test('7 张中选最优组合（桌面同花压过手中的对子）', () => {
  const r = ev(['2h', '2d', '5c', '8c', 'Jc', 'Qc', 'Kc']); // 5 张梅花
  assert.equal(r.cat, 5);
  assert.equal(r.tb[0], 11); // K 高同花
});
