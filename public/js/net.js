// WebSocket 连接管理：自动重连、消息分发
import { S, toast, saveIdentity, clearIdentity } from './store.js';

class Net {
  constructor() {
    this.ws = null;
    this.wantClose = false;
    this.backoff = 800;
    this.connect();
  }

  connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}`);
    this.ws = ws;
    ws.onopen = () => {
      S.connected = true;
      this.backoff = 800;
      if (S.token) this.send({ type: 'resume', token: S.token });
    };
    ws.onclose = () => {
      S.connected = false;
      if (!this.wantClose) {
        setTimeout(() => this.connect(), this.backoff);
        this.backoff = Math.min(this.backoff * 1.6, 8000);
      }
    };
    ws.onerror = () => {};
    ws.onmessage = ev => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      this.dispatch(msg);
    };
  }

  send(obj) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  dispatch(msg) {
    switch (msg.type) {
      case 'entered': {
        const adminToken = msg.isAdmin ? S.token : undefined;
        saveIdentity(msg.profile, msg.token, msg.isAdmin, adminToken);
        if (msg.isAdmin && S.token) localStorage.setItem('adminToken', S.token);
        if (S.pendingRoom) {
          this.send({ type: 'joinRoom', code: S.pendingRoom });
        }
        break;
      }
      case 'denied':
        toast(msg.message || '操作被拒绝', 'warn');
        if (msg.code === 'session_expired') {
          const keep = { name: S.me?.name, number: S.me?.number };
          clearIdentity();
          S.me = null;
          // 保留名称/编号便于快速重新进入
          if (keep.name) localStorage.setItem('lastId', JSON.stringify(keep));
          toast('会话已过期，请重新进入', 'warn');
        }
        if (msg.code === 'need_admin_pw') S.adminPw = '';
        break;
      case 'lobby':
        S.lobbyRooms = msg.rooms;
        break;
      case 'joined':
        S.view = 'room';
        if (msg.code) {
          location.hash = `#/r/${msg.code}`;
          S.pendingRoom = null;
        }
        break;
      case 'left':
        S.view = 'lobby';
        S.room = null;
        location.hash = '#/';
        if (msg.kicked) toast('你已被房主移出房间', 'warn');
        break;
      case 'room': {
        S.room = msg.room;
        S.clockSkew = msg.room.serverTime - Date.now();
        // 同步自己的最新余额展示
        if (S.me && msg.room.profile) S.me.chips = msg.room.profile.chips;
        break;
      }
      case 'leaderboard':
        S.leaderboard = msg.rows;
        break;
      case 'profile':
        S.profileView = msg.profile;
        // 查看自己时同步顶栏余额
        if (S.me && msg.profile && msg.profile.key === S.me.key) {
          S.me.chips = msg.profile.chips;
          localStorage.setItem('me', JSON.stringify(S.me));
        }
        break;
      case 'admin.list':
        S.adminPlayers = msg.players;
        break;
      case 'admin.ok':
        toast('操作成功', 'ok');
        this.send({ type: 'admin.list' });
        this.send({ type: 'leaderboard' });
        break;
      default:
        break;
    }
  }
}

export const net = new Net();
