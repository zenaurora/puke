// 房间聊天 + 系统日志
import { S } from '../store.js';
import { net } from '../net.js';

export const ChatPanel = {
  name: 'ChatPanel',
  setup() {
    const { ref, watch, nextTick } = Vue;
    const listEl = ref(null);
    const text = ref('');

    const msgs = Vue.computed(() => (S.room?.chat ?? []).slice(-80));

    watch(() => msgs.value.length, async () => {
      await nextTick();
      if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight;
    }, { immediate: true });

    const send = () => {
      const t = text.value.trim();
      if (!t) return;
      net.send({ type: 'chat', text: t });
      text.value = '';
    };

    const fmtTime = t => {
      const d = new Date(t);
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    };

    return { listEl, text, msgs, send, fmtTime };
  },
  template: `
    <div class="chat">
      <div class="chat-head">房间动态</div>
      <div class="chat-list" ref="listEl">
        <div v-for="(m, i) in msgs" :key="i" class="chat-row" :class="m.kind">
          <span class="chat-time">{{ fmtTime(m.t) }}</span>
          <span v-if="m.kind === 'chat'" class="chat-name">{{ m.name }}：</span>
          <span class="chat-text">{{ m.text }}</span>
        </div>
      </div>
      <div class="chat-input">
        <input v-model="text" maxlength="200" placeholder="说点什么…"
               @keydown.enter="send" @keydown.esc.prevent="text = ''" />
        <button class="btn small" @click="send">发送</button>
      </div>
    </div>
  `,
};
