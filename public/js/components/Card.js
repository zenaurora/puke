// 扑克牌渲染：code 如 'As' / 'Td'
const SUIT_CH = { s: '♠', h: '♥', d: '♦', c: '♣' };
const RANK_CH = { T: '10', J: 'J', Q: 'Q', K: 'K', A: 'A' };

export const Card = {
  name: 'PokerCard',
  props: {
    code: { type: String, default: '' },
    down: { type: Boolean, default: false }, // 背面
    size: { type: String, default: 'md' },   // xs | sm | md
    dim: { type: Boolean, default: false },
  },
  setup(props) {
    const { computed } = Vue;
    const rank = computed(() => RANK_CH[props.code[0]] ?? props.code[0] ?? '');
    const suit = computed(() => SUIT_CH[props.code[1]] ?? '');
    const red = computed(() => props.code[1] === 'h' || props.code[1] === 'd');
    return { rank, suit, red };
  },
  template: `
    <span class="card" :class="[size, { down, red, dim }]" :aria-label="down ? '暗牌' : code">
      <template v-if="!down">
        <span class="c-rank">{{ rank }}</span>
        <span class="c-suit">{{ suit }}</span>
      </template>
    </span>
  `,
};
