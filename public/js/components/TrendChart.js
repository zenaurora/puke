// 筹码走势图：纯 SVG 折线
export const TrendChart = {
  name: 'TrendChart',
  props: { history: { type: Array, default: () => [] } },
  setup(props) {
    const { computed, ref } = Vue;

    const W = 640, H = 220, PAD_X = 14, PAD_Y = 18;

    const points = computed(() => (props.history ?? []).map((h, i) => ({ ...h, i })));

    const scale = computed(() => {
      const pts = points.value;
      if (!pts.length) return null;
      const ys = pts.map(p => p.balance);
      let lo = Math.min(...ys, 0), hi = Math.max(...ys, 0);
      if (lo === hi) { lo -= 10; hi += 10; }
      const span = hi - lo;
      lo -= span * 0.08; hi += span * 0.08;
      const n = Math.max(pts.length - 1, 1);
      return {
        lo, hi, n,
        x: i => PAD_X + (W - PAD_X * 2) * (i / n),
        y: v => H - PAD_Y - (H - PAD_Y * 2) * ((v - lo) / (hi - lo)),
      };
    });

    const path = computed(() => {
      const s = scale.value;
      if (!s) return '';
      return points.value.map((p, i) => `${i ? 'L' : 'M'}${s.x(i).toFixed(1)},${s.y(p.balance).toFixed(1)}`).join(' ');
    });
    const areaPath = computed(() => {
      const s = scale.value;
      if (!s) return '';
      const last = points.value.length - 1;
      return `${path.value} L${s.x(last).toFixed(1)},${H - PAD_Y} L${s.x(0).toFixed(1)},${H - PAD_Y} Z`;
    });
    const zeroY = computed(() => {
      const s = scale.value;
      if (!s || s.lo > 0 || s.hi < 0) return null;
      return s.y(0);
    });

    const selected = ref(-1);
    const pick = i => { selected.value = selected.value === i ? -1 : i; };
    const selPoint = computed(() => selected.value >= 0 ? points.value[selected.value] : null);

    const fmt = t => {
      const d = new Date(t);
      return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    };
    const sgn = v => (v > 0 ? `+${v.toLocaleString()}` : v.toLocaleString());

    return { W, H, points, scale, path, areaPath, zeroY, selected, pick, selPoint, fmt, sgn };
  },
  template: `
    <div class="trend">
      <div v-if="!points.length" class="empty-state">
        <div class="ico">📈</div>
        <div>暂无对局记录</div>
        <div class="sub">结算后的输赢会以走势图呈现</div>
      </div>
      <template v-else>
        <svg :viewBox="\`0 0 \${W} \${H}\`" class="trend-svg" preserveAspectRatio="none">
          <defs>
            <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#d3b06a" stop-opacity=".28"/>
              <stop offset="100%" stop-color="#d3b06a" stop-opacity="0"/>
            </linearGradient>
          </defs>
          <line v-if="zeroY !== null" :x1="0" :x2="W" :y1="zeroY" :y2="zeroY" class="trend-zero" />
          <path :d="areaPath" fill="url(#trendFill)" />
          <path :d="path" class="trend-line" fill="none" />
          <circle v-for="(p, i) in points" :key="i"
                  :cx="scale.x(i)" :cy="scale.y(p.balance)" r="4.5"
                  class="trend-dot" :class="{ up: p.delta > 0, down: p.delta < 0, sel: selected === i }"
                  @click="pick(i)" />
        </svg>
        <div v-if="selPoint" class="trend-detail">
          <span class="td-time">{{ fmt(selPoint.t) }}</span>
          <span class="td-delta" :class="selPoint.delta > 0 ? 'up' : selPoint.delta < 0 ? 'down' : ''">
            {{ sgn(selPoint.delta) }}
          </span>
          <span class="td-balance">余额 {{ selPoint.balance.toLocaleString() }}</span>
          <span v-if="selPoint.room" class="td-room">{{ selPoint.room }}</span>
          <span v-if="selPoint.note" class="td-note">{{ selPoint.note }}</span>
        </div>
        <div v-else class="trend-hint">点击圆点查看明细</div>
      </template>
    </div>
  `,
};
