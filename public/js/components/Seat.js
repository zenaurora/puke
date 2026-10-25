// 牌桌上的一个座位
import { S } from '../store.js';
import { Card } from './Card.js';

const ACTION_CN = {
  fold: '弃牌', check: '过牌', call: '跟注', bet: '下注', raise: '加注', allin: '全下',
};

export const Seat = {
  name: 'Seat',
  components: { Card },
  props: {
    seat: { type: Object, required: true }, // 快照中的座位（可为空对象 {empty:true, seat:n}）
    empty: { type: Boolean, default: false },
  },
  setup(props) {
    const { computed } = Vue;
    const room = Vue.computed(() => S.room);

    const isToAct = computed(() => {
      const h = room.value?.hand;
      return !!(props.seat && h && !h.finished && h.toActKey === props.seat.key);
    });
    const remaining = computed(() => {
      if (!isToAct.value || !room.value?.actionDeadline) return null;
      const r = (room.value.actionDeadline - (S.now + S.clockSkew)) / 1000;
      return Math.max(0, Math.ceil(r));
    });
    const actionText = computed(() => {
      const la = props.seat?.lastAction;
      if (!la) return '';
      if (la.type === 'fold') return '弃牌';
      if (la.type === 'check') return '过牌';
      if (la.type === 'call') return `跟 ${la.amount}`;
      if (la.type === 'bet') return `下 ${la.amount}`;
      if (la.type === 'raise') return `加到 ${la.amount}`;
      if (la.type === 'allin') return '全下';
      return '';
    });
    const winnerKeys = computed(() => {
      const h = room.value?.hand;
      if (!h?.finished || !h.showdown) return new Set();
      return new Set(h.showdown.results.flatMap(r => r.winners.map(w => w.key)));
    });
    const winAmount = computed(() => {
      const h = room.value?.hand;
      if (!h?.finished || !h.showdown) return 0;
      return h.showdown.results
        .flatMap(r => r.winners)
        .filter(w => w.key === props.seat?.key)
        .reduce((s, w) => s + w.amount, 0);
    });
    const myCards = computed(() =>
      props.seat?.isMe ? (room.value?.myHole ?? []) : []);
    return { isToAct, remaining, actionText, winnerKeys, winAmount, myCards, ACTION_CN, room };
  },
  template: `
    <div v-if="empty" class="seat empty" :key="'e'+seat.seat">
      <button v-if="room && !room.inHand || room.mySeat < 0" class="seat-empty-btn"
              @click="$emit('sit', seat.seat)" title="入座">＋</button>
      <span v-else class="seat-empty-mark"></span>
    </div>
    <div v-else class="seat" :class="{
        me: seat.isMe, folded: seat.folded, acting: isToAct,
        offline: !seat.connected, winner: winnerKeys.has(seat.key) }">
      <div class="seat-cards">
        <template v-if="seat.isMe && myCards.length">
          <Card v-for="(c,i) in myCards" :key="i" :code="c" size="sm" class="mine" />
        </template>
        <template v-else-if="seat.hole">
          <Card v-for="(c,i) in seat.hole" :key="i" :code="c" size="xs" />
        </template>
        <template v-else-if="seat.inHand">
          <Card key="b1" down size="xs" /><Card key="b2" down size="xs" />
        </template>
      </div>

      <div class="seat-plate">
        <div class="seat-line1">
          <span class="seat-name">{{ seat.name }}<i class="seat-num">#{{ seat.number ?? '' }}</i></span>
          <span v-if="seat.isButton" class="dbtn" title="庄家按钮">D</span>
          <span v-if="!seat.connected" class="offline-tag">离线</span>
        </div>
        <div class="seat-line2">
          <span class="seat-stack">{{ seat.stack.toLocaleString() }}</span>
          <span v-if="seat.buys > 1" class="seat-buys" title="买入次数">×{{ seat.buys }}</span>
        </div>
        <div v-if="remaining !== null" class="seat-timer" :class="{ urgent: remaining <= 5 }">{{ remaining }}s</div>
        <div v-if="actionText" class="seat-action">{{ actionText }}</div>
        <div v-if="winnerKeys.has(seat.key)" class="seat-win">+{{ winAmount.toLocaleString() }}</div>
      </div>

      <div v-if="seat.bet > 0" class="seat-bet">
        <span class="chip-ico">●</span>{{ seat.bet.toLocaleString() }}
      </div>
      <div v-if="seat.allIn && !seat.folded" class="seat-allin">ALL IN</div>
    </div>
  `,
};
