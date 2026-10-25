// 德州扑克牌型评估：7 张选最优 5 张
import { rankOf, suitOf, rankLabel } from './cards.js';

export const CAT = {
  HIGH: 0, PAIR: 1, TWO_PAIR: 2, TRIPS: 3,
  STRAIGHT: 4, FLUSH: 5, FULL_HOUSE: 6, QUADS: 7, STRAIGHT_FLUSH: 8,
};

// 评估 5 张牌 → {cat, tb:[]}，tb 为同类别内比较用的降序权重数组
function evaluate5(cards) {
  const rs = cards.map(rankOf).sort((a, b) => b - a);
  const flush = cards.every(c => suitOf(c) === suitOf(cards[0]));

  const cnt = new Map();
  for (const r of rs) cnt.set(r, (cnt.get(r) || 0) + 1);
  // 按出现次数、点数降序分组
  const groups = [...cnt.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);

  const uniq = [...cnt.keys()].sort((a, b) => b - a);
  let straightHigh = 0;
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0];
    else if (uniq[0] === 12 && uniq[1] === 3) straightHigh = 3; // A2345 轮子，5 为高牌
  }

  if (flush && straightHigh) return { cat: 8, tb: [straightHigh] };
  if (groups[0][1] === 4) return { cat: 7, tb: [groups[0][0], groups[1][0]] };
  if (groups[0][1] === 3 && groups[1][1] === 2) return { cat: 6, tb: [groups[0][0], groups[1][0]] };
  if (flush) return { cat: 5, tb: rs };
  if (straightHigh) return { cat: 4, tb: [straightHigh] };
  if (groups[0][1] === 3) return { cat: 3, tb: [groups[0][0], groups[1][0], groups[2][0]] };
  if (groups[0][1] === 2 && groups[1][1] === 2) return { cat: 2, tb: [groups[0][0], groups[1][0], groups[2][0]] };
  if (groups[0][1] === 2) return { cat: 1, tb: [groups[0][0], groups[1][0], groups[2][0], groups[3][0]] };
  return { cat: 0, tb: rs };
}

export function cmpEval(a, b) {
  if (a.cat !== b.cat) return a.cat - b.cat;
  const n = Math.max(a.tb.length, b.tb.length);
  for (let i = 0; i < n; i++) {
    const d = (a.tb[i] ?? 0) - (b.tb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

// 7 张牌取最优 5 张组合
export function evaluate7(cards) {
  let best = null, bestCards = null;
  const n = cards.length;
  for (let a = 0; a < n - 4; a++)
    for (let b = a + 1; b < n - 3; b++)
      for (let c = b + 1; c < n - 2; c++)
        for (let d = c + 1; d < n - 1; d++)
          for (let e = d + 1; e < n; e++) {
            const combo = [cards[a], cards[b], cards[c], cards[d], cards[e]];
            const r = evaluate5(combo);
            if (!best || cmpEval(r, best) > 0) { best = r; bestCards = combo; }
          }
  return { ...best, cards: bestCards };
}

// 中文牌型描述，如 "葫芦（K带9）"、"两对（A和7）"
export function handName(ev) {
  const L = i => rankLabel(ev.tb[i]);
  switch (ev.cat) {
    case 8: return ev.tb[0] === 12 ? '皇家同花顺' : `同花顺（${L(0)} 高）`;
    case 7: return `四条 ${L(0)}`;
    case 6: return `葫芦（${L(0)} 带 ${L(1)}）`;
    case 5: return `同花（${L(0)} 高）`;
    case 4: return `顺子（${L(0)} 高）`;
    case 3: return `三条 ${L(0)}`;
    case 2: return `两对（${L(0)} 和 ${L(1)}）`;
    case 1: return `一对 ${L(0)}`;
    default: return `高牌 ${L(0)}`;
  }
}
