// 应用入口：根组件、路由、组装
import { S, askConfirm } from './store.js';
import { net } from './net.js';
import { LobbyView } from './components/LobbyView.js';
import { RoomView } from './components/RoomView.js';
import { RulesModal } from './components/RulesModal.js';

const { createApp, h, computed } = Vue;

// hash 路由：#/ 大厅；#/r/CODE 房间
function applyHash() {
  const m = location.hash.match(/^#\/r\/([0-9A-Z]+)/i);
  if (m) {
    const code = m[1].toUpperCase();
    S.pendingRoom = code;
    if (S.me && S.view !== 'room') net.send({ type: 'joinRoom', code });
  } else if (S.view === 'room' && !location.hash.startsWith('#/r/')) {
    // 从房间 hash 离开时主动退房
    net.send({ type: 'leaveRoom' });
  }
}
window.addEventListener('hashchange', applyHash);
applyHash();

const App = {
  setup() {
    const view = computed(() => (S.view === 'room' && S.room ? 'room' : 'lobby'));
    const openRules = () => { S.rulesOpen = true; };
    return () => h('div', { class: 'app' }, [
      h('header', { class: 'topbar' }, [
        h('div', { class: 'brand', onClick: () => { if (S.view !== 'room') location.hash = '#/'; } }, [
          h('span', { class: 'brand-suit' }, '♠'),
          h('span', { class: 'brand-name' }, '德州之夜'),
          h('span', { class: 'brand-sub' }, 'HOLD\'EM NIGHT'),
        ]),
        h('div', { class: 'topbar-right' }, [
          h('span', { class: 'conn-dot ' + (S.connected ? 'on' : 'off'), title: S.connected ? '已连接' : '连接中…' }),
          S.me ? h('span', { class: 'me-chip' }, [
            h('b', null, S.me.name),
            h('span', { class: 'me-num' }, ` #${S.me.number}`),
          ]) : null,
          h('button', { class: 'btn ghost small', onClick: openRules }, '规则'),
        ]),
      ]),
      h('main', { class: 'main' }, [
        view.value === 'room' ? h(RoomView) : h(LobbyView),
      ]),
      S.rulesOpen ? h(RulesModal) : null,
      S.confirmQ ? h('div', { class: 'modal-mask', onClick: e => { if (e.target === e.currentTarget) S.confirmQ.cancel(); } }, [
        h('div', { class: 'modal confirm-modal' }, [
          h('div', { class: 'confirm-text' }, S.confirmQ.text),
          h('div', { class: 'confirm-ops' }, [
            h('button', { class: 'btn ghost', onClick: S.confirmQ.cancel }, '取消'),
            h('button', { class: 'btn gold', onClick: S.confirmQ.ok }, '确认'),
          ]),
        ]),
      ]) : null,
      h('div', { class: 'toasts' }, S.toasts.map(t =>
        h('div', { class: 'toast ' + t.kind, key: t.id }, t.text))),
    ]);
  },
};

createApp(App).mount('#app');

// Material 涟漪：按下时在按钮/标签等表面扩散
const RIPPLE_HOSTS = '.btn, .chip-btn, .tab, .rules-nav-item, .room-code, .seat-empty-btn';
document.addEventListener('pointerdown', e => {
  const host = e.target.closest?.(RIPPLE_HOSTS);
  if (!host || host.disabled) return;
  const r = host.getBoundingClientRect();
  const d = Math.max(r.width, r.height) * 1.1;
  const span = document.createElement('span');
  span.className = 'ripple';
  span.style.width = span.style.height = d + 'px';
  span.style.left = (e.clientX - r.left - d / 2) + 'px';
  span.style.top = (e.clientY - r.top - d / 2) + 'px';
  host.appendChild(span);
  span.addEventListener('animationend', () => span.remove());
  setTimeout(() => span.remove(), 700); // 兜底
});
