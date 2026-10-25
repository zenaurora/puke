// 前端响应式状态
const { reactive } = Vue;

const saved = JSON.parse(localStorage.getItem('me') || 'null');

export const S = reactive({
  connected: false,
  entering: false,
  me: saved,          // {key, name, number, chips}
  isAdmin: false,
  token: localStorage.getItem('token') || '',
  adminToken: localStorage.getItem('adminToken') || '',
  adminPw: '',
  view: 'lobby',      // lobby | room
  pendingRoom: null,  // 进入身份后要加入的房间码
  lobbyRooms: [],
  room: null,
  clockSkew: 0,
  now: Date.now(),
  toasts: [],
  profileView: null,
  leaderboard: [],
  adminPlayers: [],
  adminMsg: '',
  rulesOpen: false,
  chatOpen: true,
  confirmQ: null,
});

let toastId = 0;
export function toast(text, kind = 'info') {
  const id = ++toastId;
  S.toasts.push({ id, text, kind });
  setTimeout(() => {
    const i = S.toasts.findIndex(t => t.id === id);
    if (i >= 0) S.toasts.splice(i, 1);
  }, 3600);
}

// 应用内确认弹窗（替代原生 confirm）
export function askConfirm(text) {
  return new Promise(resolve => {
    S.confirmQ = {
      text,
      ok: () => { S.confirmQ = null; resolve(true); },
      cancel: () => { S.confirmQ = null; resolve(false); },
    };
  });
}

export function saveIdentity(profile, token, isAdmin, adminToken) {
  S.me = profile && { key: profile.key, name: profile.name, number: profile.number, chips: profile.chips };
  S.isAdmin = !!isAdmin;
  if (token) { S.token = token; localStorage.setItem('token', token); }
  if (adminToken !== undefined) {
    S.adminToken = adminToken || '';
    if (adminToken) localStorage.setItem('adminToken', adminToken);
    else localStorage.removeItem('adminToken');
  }
  if (profile) localStorage.setItem('me', JSON.stringify(S.me));
}

export function clearIdentity() {
  S.me = null; S.isAdmin = false; S.token = ''; S.adminToken = '';
  S.room = null; S.view = 'lobby'; S.profileView = null; S.pendingRoom = null;
  localStorage.removeItem('token');
  localStorage.removeItem('adminToken');
  localStorage.removeItem('me');
}

// 每秒走表（供倒计时/时间显示）
setInterval(() => { S.now = Date.now(); }, 250);
