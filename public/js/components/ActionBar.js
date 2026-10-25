// 我的行动条：弃牌 / 过牌 / 跟注 / 加注
import { S } from '../store.js';
import { net } from '../net.js';
import { toast } from '../store.js';

export const ActionBar = {
  name: 'ActionBar',
  setup() {
    const { computed, ref, watch } = Vue;

    const legal = computed(() => S.room?.myLegal ?? null);
    const hand = computed(() => S.room?.hand ?? null);
    const pot = computed(() => hand.value?.pot ?? 0);

    // 加注目标额
    const raiseTo = ref(0);
    watch(legal, l => {
      if (l && (l.canBet || l.canRaise)) raiseTo.value = l.minTo;
    }, { immediate: true });

    const clamp = v => {
      const l = legal.value;
      if (!l) return 0;
      return Math.max(l.minTo, Math.min(l.maxTo, Math.round(v) || l.minTo));
    };
    const presets = computed(() => {
      const l = legal.value, h = hand.value;
      if (!l || (!l.canBet && !l.canRaise) || !h) return [];
      const cur = h.currentBet;
      const p = pot.value;
      const list = [
        { label: '最小', v: l.minTo },
        { label: '半池', v: clamp(cur + Math.round(p / 2)) },
        { label: '满池', v: clamp(cur + p) },
        { label: '全下', v: l.maxTo },
      ];
      const seen = new Set();
      return list.filter(x => { if (seen.has(x.v) || x.v < l.minTo) return false; seen.add(x.v); return true; });
    });

    const act = (action, to) => net.send({ type: 'action', action, to });
    const doFold = () => act('fold');
    const doCheck = () => act('check');
    const doCall = () => act('call');
    const doRaise = () => {
      const l = legal.value;
      if (!l) return;
      if (raiseTo.value < l.minTo || raiseTo.value > l.maxTo) return toast('加注额度不合法', 'warn');
      act(l.canBet && !hand.value?.currentBet ? 'bet' : 'raise', raiseTo.value);
    };
    const doAllin = () => act('allin');

    return { legal, hand, pot, raiseTo, presets, doFold, doCheck, doCall, doRaise, doAllin };
  },
  template: `
    <div v-if="legal" class="actionbar">
      <div class="ab-left">
        <button class="btn danger" @click="doFold">弃牌</button>
        <button v-if="legal.canCheck" class="btn" @click="doCheck">过牌</button>
        <button v-if="legal.canCall" class="btn primary" @click="doCall">
          跟注 {{ legal.toCall.toLocaleString() }}
        </button>
      </div>
      <div v-if="legal.canBet || legal.canRaise" class="ab-raise">
        <div class="ab-presets">
          <button v-for="p in presets" :key="p.label" class="chip-btn"
                  :class="{ on: raiseTo === p.v }" @click="raiseTo = p.v">{{ p.label }}</button>
        </div>
        <div class="ab-slider">
          <input type="range" :min="legal.minTo" :max="legal.maxTo" :step="1" v-model.number="raiseTo" />
          <input type="number" class="raise-num" :min="legal.minTo" :max="legal.maxTo" v-model.number="raiseTo" />
        </div>
        <button class="btn gold" @click="doRaise">
          {{ legal.canBet && !hand.currentBet ? '下注' : '加注到' }} {{ (+raiseTo || legal.minTo).toLocaleString() }}
        </button>
      </div>
      <button class="btn ghost allin" @click="doAllin">全下</button>
    </div>
    <div v-else-if="hand && !hand.finished" class="actionbar idle">
      <span>等待其他玩家行动…</span>
    </div>
  `,
};
