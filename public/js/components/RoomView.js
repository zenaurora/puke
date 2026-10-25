// 房间视图：牌桌、座位、公共牌、房主控制、聊天
import { S, toast, askConfirm } from '../store.js';
import { net } from '../net.js';
import { Seat } from './Seat.js';
import { Card } from './Card.js';
import { ActionBar } from './ActionBar.js';
import { ChatPanel } from './ChatPanel.js';

const STREET_CN = { preflop: '翻牌前', flop: '翻牌', turn: '转牌', river: '河牌', showdown: '摊牌' };

export const RoomView = {
  name: 'RoomView',
  components: { Seat, Card, ActionBar, ChatPanel },
  setup() {
    const { computed, ref } = Vue;

    const room = computed(() => S.room);
    const isHost = computed(() => room.value?.hostKey === S.me?.key);
    const seated = computed(() => (room.value?.mySeat ?? -1) >= 0);

    // 复制邀请链接
    const copyLink = async () => {
      const url = `${location.origin}/#/r/${room.value.code}`;
      try {
        await navigator.clipboard.writeText(url);
        toast('邀请链接已复制', 'ok');
      } catch {
        toast(`邀请链接：${url}`);
      }
    };

    // 座位展示顺序：我的座位固定在 6 点钟方向
    const mySeat = computed(() => room.value?.mySeat ?? -1);
    const seatStyles = computed(() => {
      const arr = [];
      for (let i = 0; i < 9; i++) {
        const angleDeg = 90 + ((i - (mySeat.value >= 0 ? mySeat.value : 4)) * 40);
        const a = angleDeg * Math.PI / 180;
        const rx = 42, ry = 41;
        arr.push({
          left: `${50 + rx * Math.cos(a)}%`,
          top: `${50 + ry * Math.sin(a)}%`,
        });
      }
      return arr;
    });
    const seatData = computed(() =>
      (room.value?.seats ?? []).map((s, i) => s ? { ...s, i } : { empty: true, seat: i }));

    // 下注筹码的位置：沿座位角度向桌心偏移
    const winnerList = computed(() => {
      const h = room.value?.hand;
      if (!h?.finished || !h.showdown) return [];
      return h.showdown.results.map(r => ({
        amount: r.amount,
        winners: r.winners.map(w => w.hand ? `${w.name}（${w.hand}）` : w.name).join('、'),
      }));
    });

    // 房主控制
    const doStart = () => net.send({ type: 'start' });
    const doPause = () => net.send({ type: 'pause' });
    const doNext = () => net.send({ type: 'nextHand' });
    const doClose = async () => {
      if (await askConfirm('结束房间？所有桌上筹码将立即结算并记入余额。')) net.send({ type: 'closeRoom' });
    };
    const doStand = () => net.send({ type: 'stand' });
    const doRebuy = () => net.send({ type: 'rebuy' });
    const doLeave = async () => {
      const msg = seated.value ? '离开房间？桌上筹码将按本局结算记入余额。' : '离开房间？';
      if (await askConfirm(msg)) net.send({ type: 'leaveRoom' });
    };
    const doSit = seat => net.send({ type: 'sit', seat });
    const kick = async key => {
      if (await askConfirm('将该玩家结账并移出房间？')) net.send({ type: 'kick', key });
    };

    const showChat = ref(true);
    const toggleChat = () => { showChat.value = !showChat.value; S.chatOpen = showChat.value; };

    const pot = computed(() => room.value?.hand?.pot ?? 0);
    const phaseHint = computed(() => {
      const r = room.value;
      if (!r) return '';
      if (r.phase === 'lobby') return '等待房主开始';
      if (r.phase === 'paused') return '已暂停';
      if (r.phase === 'handend') return '短暂休息，即将开始下一手';
      const h = r.hand;
      if (h?.finished) return '本手已结束';
      return h ? `${STREET_CN[h.street] ?? h.street} · 第 ${r.handNo} 手` : '';
    });

    return {
      S, room, isHost, seated, mySeat, seatStyles, seatData, winnerList,
      copyLink, doStart, doPause, doNext, doClose, doStand, doRebuy, doLeave, doSit, kick,
      showChat, toggleChat, pot, phaseHint, STREET_CN,
    };
  },
  template: `
    <div v-if="room" class="room">
      <div class="room-top">
        <div class="room-title">
          <b>{{ room.name }}</b>
          <button class="room-code" @click="copyLink" title="点击复制邀请链接">{{ room.code }} ⧉</button>
          <span class="muted small">盲注 {{ room.settings.sb }}/{{ room.settings.sb * 2 }}<template v-if="room.settings.ante"> · 前注 {{ room.settings.ante }}</template></span>
          <span class="muted small">{{ phaseHint }}</span>
        </div>
        <div class="room-ops">
          <template v-if="isHost">
            <button v-if="room.phase === 'lobby'" class="btn primary small" @click="doStart">开始游戏</button>
            <button v-if="['playing','handend'].includes(room.phase)" class="btn ghost small" @click="doPause">{{ room.phase === 'paused' ? '继续' : '暂停' }}</button>
            <button v-if="room.phase !== 'lobby' && room.phase !== 'playing'" class="btn ghost small" @click="doNext">立即下一手</button>
            <button class="btn danger-ghost small" @click="doClose">结束房间</button>
          </template>
          <button v-if="seated" class="btn ghost small" @click="doStand">站起结算</button>
          <button v-if="room.canRebuy" class="btn gold small" @click="doRebuy">再买入 {{ room.settings.startingChips.toLocaleString() }}</button>
          <button class="btn ghost small chat-toggle" @click="toggleChat">{{ showChat ? '隐藏动态' : '动态' }}</button>
          <button class="btn danger-ghost small" @click="doLeave">离开</button>
        </div>
      </div>

      <div class="room-body" :class="{ 'chat-hidden': !showChat }">
        <div class="table-wrap">
          <div class="felt">
            <!-- 座位 -->
            <div v-for="(s, i) in seatData" :key="i" class="seat-pos" :style="seatStyles[i]">
              <template v-if="s.empty">
                <Seat :seat="{ seat: i }" :empty="true" @sit="doSit" />
              </template>
              <template v-else>
                <Seat :seat="s" />
                <button v-if="isHost && !s.isMe && !s.connected" class="kick-btn" title="结账并移除" @click="kick(s.key)">✕</button>
              </template>
            </div>

            <!-- 桌心 -->
            <div class="table-center">
              <div v-if="room.hand" class="board">
                <Card v-for="(c, i) in room.hand.board" :key="i" :code="c" size="md" />
                <template v-if="room.hand.board.length === 0 && !room.hand.finished">
                  <Card v-for="i in 5" :key="'p'+i" down size="md" dim />
                </template>
              </div>
              <div v-if="pot > 0" class="pot-chip">彩池 {{ pot.toLocaleString() }}</div>
              <div v-if="room.hand?.finished && winnerList.length" class="winner-banner">
                <div v-for="(w, i) in winnerList" :key="i" class="winner-line">
                  🏆 {{ w.winners }} 赢 {{ w.amount.toLocaleString() }}
                </div>
              </div>
              <div v-else-if="room.hand && !room.hand.finished && room.hand.toActKey" class="street-label">
                {{ STREET_CN[room.hand.street] }}
              </div>
            </div>
          </div>

          <!-- 旁观提示 -->
          <div v-if="!seated" class="spectate-bar">
            你正在旁观 —— 公共牌与彩池可见，看不到任何底牌。点击空座位上的 ＋ 入座。
          </div>

          <ActionBar />
        </div>

        <div class="room-chat" v-if="showChat">
          <ChatPanel />
        </div>
      </div>
    </div>
    <div v-else class="muted center-pad">正在进入房间…</div>
  `,
};
