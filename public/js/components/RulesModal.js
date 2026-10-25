// 规则手册弹窗：随时快速查看
import { S } from '../store.js';
import { RULES } from '../rules.js';

export const RulesModal = {
  name: 'RulesModal',
  setup() {
    const { ref, onMounted, onUnmounted, nextTick } = Vue;
    const active = ref(RULES[0].id);
    const contentEl = ref(null);

    const jump = id => {
      active.value = id;
      if (contentEl.value) contentEl.value.scrollTop = 0;
    };
    const close = () => { S.rulesOpen = false; };
    const onKey = e => { if (e.key === 'Escape') close(); };
    onMounted(() => window.addEventListener('keydown', onKey));
    onUnmounted(() => window.removeEventListener('keydown', onKey));

    return { RULES, active, jump, close, contentEl };
  },
  template: `
    <div class="modal-mask" @click.self="close">
      <div class="modal rules-modal">
        <div class="modal-head">
          <span class="modal-title">♠ 规则手册</span>
          <button class="btn ghost small" @click="close">关闭 ✕</button>
        </div>
        <div class="rules-body">
          <nav class="rules-nav">
            <button v-for="s in RULES" :key="s.id"
                    class="rules-nav-item" :class="{ on: active === s.id }"
                    @click="jump(s.id)">{{ s.title }}</button>
          </nav>
          <div class="rules-content" ref="contentEl">
            <template v-for="s in RULES" :key="s.id">
              <div v-if="active === s.id">
                <h3>{{ s.title }}</h3>
                <div v-html="s.html"></div>
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>
  `,
};
