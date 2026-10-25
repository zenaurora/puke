// 牌的表示：两字符字符串，如 'As' 'Td' '2c'。点数 2-9/T/J/Q/K/A，花色 s h d c
import { randomInt } from 'node:crypto';

export const RANKS = '23456789TJQKA'; // 索引即点数大小 0..12
export const SUITS = ['s', 'h', 'd', 'c'];

export function rankOf(card) { return RANKS.indexOf(card[0]); }
export function suitOf(card) { return card[1]; }

export function rankLabel(r) {
  return { T: '10', J: 'J', Q: 'Q', K: 'K', A: 'A' }[RANKS[r]] ?? String(r + 2);
}

export function newDeck() {
  const d = [];
  for (const r of RANKS) for (const s of SUITS) d.push(r + s);
  return d;
}

// Fisher-Yates，使用 crypto 随机数
export function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
