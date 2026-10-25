// 大厅：身份进入、创建/加入房间、战绩走势、排行榜、管理面板
import { S, toast, clearIdentity } from '../store.js';
import { net } from '../net.js';
import { TrendChart } from './TrendChart.js';

export const LobbyView = {
  name: 'LobbyView',
  components: { TrendChart },
  setup() {
    const { ref, computed, watch } = Vue;

    // —— 进入身份 ——
    const lastId = JSON.parse(localStorage.getItem('lastId') || 'null');
    const inName = ref((S.me?.name) ?? lastId?.name ?? '');
    const inNumber = ref((S.me?.number) ?? lastId?.number ?? '');
    const inPw = ref('');
    const enterErr = ref('');
    const doEnter = () => {
      if (!inName.value.trim() || inNumber.value === '') return toast('请输入名称和编号', 'warn');
      net.send({
        type: 'enter',
        name: inName.value.trim(),
        number: Number(inNumber.value),
        adminPw: inPw.value || undefined,
        adminToken: inPw.value ? undefined : (S.adminToken || undefined),
      });
    };

    // —— 标签页 ——
    const tab = ref('play');
    const tabs = computed(() => {
      const t = [
        { id: 'play', label: '游戏' },
        { id: 'stats', label: '战绩' },
        { id: 'rank', label: '排行' },
      ];
      if (S.isAdmin) t.push({ id: 'admin', label: '管理' });
      return t;
    });
    watch(tab, t => {
      if (t === 'rank') net.send({ type: 'leaderboard' });
      if (t === 'stats') { net.send({ type: 'leaderboard' }); loadProfile(selKey.value); }
      if (t === 'admin') net.send({ type: 'admin.list' });
    });
    watch(() => S.me, me => { if (me) { net.send({ type: 'lobby' }); net.send({ type: 'leaderboard' }); } }, { immediate: true });

    // —— 创建房间 ——
    const roomName = ref('');
    const cfg = ref({ startingChips: 1000, sb: 10, ante: 0, actionTime: 30, rebuys: true });
    const createRoom = () => {
      net.send({ type: 'createRoom', settings: { name: roomName.value, ...cfg.value } });
    };

    // —— 加入房间 ——
    const joinCode = ref('');
    const doJoin = () => {
      const c = joinCode.value.trim().toUpperCase();
      if (c.length < 4) return toast('请输入房间码', 'warn');
      net.send({ type: 'joinRoom', code: c });
    };
    const joinFromList = code => net.send({ type: 'joinRoom', code });

    // —— 战绩 ——
    const selKey = ref('');
    watch(() => S.leaderboard, lb => {
      if (!selKey.value) selKey.value = S.me?.key ?? '';
    });
    const loadProfile = key => { if (key) net.send({ type: 'profile', key }); };
    watch(selKey, k => loadProfile(k));
    const profile = computed(() => S.profileView);
    const playerOptions = computed(() => {
      const rows = [...S.leaderboard];
      if (S.me && !rows.some(r => r.key === S.me.key)) rows.unshift({ key: S.me.key, name: S.me.name, number: S.me.number, chips: S.me.chips });
      return rows;
    });
    const netWorth = computed(() => {
      const h = profile.value?.history ?? [];
      return h.length > 1 ? profile.value.chips - h[0].balance : 0;
    });
    const games = computed(() => Math.max(0, (profile.value?.history?.length ?? 0) - 1));
    const fmt = t => {
      const d = new Date(t);
      return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    };
    const sgn = v => (v > 0 ? `+${v.toLocaleString()}` : v.toLocaleString());

    // —— 排行 ——
    const rankRows = computed(() => S.leaderboard);
    const openProfileOf = key => { tab.value = 'stats'; selKey.value = key; };

    // —— 管理 ——
    const addForm = ref({ name: '', number: '', chips: 1000 });
    const doAdd = () => {
      if (!addForm.value.name.trim() || addForm.value.number === '') return toast('请填写名称和编号', 'warn');
      net.send({ type: 'admin.addPlayer', name: addForm.value.name.trim(), number: Number(addForm.value.number), chips: Number(addForm.value.chips) || 0 });
      addForm.value = { name: '', number: '', chips: 1000 };
    };
    const adjustKey = ref('');
    const adjustDelta = ref('');
    const adjustNote = ref('');
    const startAdjust = key => { adjustKey.value = adjustKey.value === key ? '' : key; adjustDelta.value = ''; adjustNote.value = ''; };
    const doAdjust = key => {
      const d = Number(adjustDelta.value);
      if (!d) return toast('请输入非零的调整额度（可用负数）', 'warn');
      net.send({ type: 'admin.adjust', key, delta: d, note: adjustNote.value.trim() || undefined });
      adjustKey.value = '';
    };
    const pwForm = ref({ a: '', b: '' });
    const doSetPw = () => {
      if (pwForm.value.a.length < 4) return toast('新密码至少 4 位', 'warn');
      if (pwForm.value.a !== pwForm.value.b) return toast('两次输入不一致', 'warn');
      net.send({ type: 'admin.setPassword', pw: pwForm.value.a });
      pwForm.value = { a: '', b: '' };
    };

    const logout = () => { net.send({ type: 'leaveRoom' }); clearIdentity(); location.hash = '#/'; location.reload(); };

    return {
      S, inName, inNumber, inPw, enterErr, doEnter,
      tab, tabs, roomName, cfg, createRoom, joinCode, doJoin, joinFromList,
      selKey, profile, playerOptions, netWorth, games, fmt, sgn, loadProfile,
      rankRows, openProfileOf,
      addForm, doAdd, adjustKey, adjustDelta, adjustNote, startAdjust, doAdjust, pwForm, doSetPw,
      logout,
    };
  },
  template: `
    <div class="lobby">
      <!-- 未进入身份 -->
      <div v-if="!S.me" class="card enter-card">
        <div class="enter-head">
          <div class="enter-logo">♠ ♥ ♦ ♣</div>
          <h1>德州之夜</h1>
          <p class="muted">输入你的 名称 + 编号 进入</p>
        </div>
        <div class="enter-form">
          <label class="field">
            <span>名称</span>
            <input v-model="inName" maxlength="16" placeholder="你的名字" @keydown.enter="doEnter" />
          </label>
          <label class="field">
            <span>编号</span>
            <input v-model="inNumber" type="number" min="0" max="999" placeholder="如 33" @keydown.enter="doEnter" />
          </label>
          <label class="field pw">
            <span>管理员密码 <em>(仅管理员本人需要)</em></span>
            <input v-model="inPw" type="password" placeholder="普通玩家留空" @keydown.enter="doEnter" />
          </label>
          <button class="btn primary big" @click="doEnter">进入</button>
          <p class="hint">还没有账号？把想要的「名称 编号」发给管理员，由他帮你开通。</p>
        </div>
      </div>

      <!-- 已进入 -->
      <template v-else>
        <div class="tabs">
          <button v-for="t in tabs" :key="t.id" class="tab" :class="{ on: tab === t.id }" @click="tab = t.id">
            {{ t.label }}
          </button>
          <div class="tabs-right">
            <span class="me-balance" title="总余额">💰 {{ S.me.chips.toLocaleString() }}</span>
            <button class="btn ghost small" @click="logout">退出</button>
          </div>
        </div>

        <!-- 游戏 -->
        <div v-if="tab === 'play'" class="play-grid">
          <div class="card">
            <h3>创建房间</h3>
            <label class="field"><span>房名</span><input v-model="roomName" maxlength="30" :placeholder="S.me.name + ' 的房间'" /></label>
            <div class="field-row">
              <label class="field"><span>每人开局筹码</span><input v-model.number="cfg.startingChips" type="number" min="50" step="50" /></label>
              <label class="field"><span>小盲</span><input v-model.number="cfg.sb" type="number" min="1" /></label>
              <label class="field"><span>前注</span><input v-model.number="cfg.ante" type="number" min="0" /></label>
            </div>
            <div class="field-row">
              <label class="field"><span>行动时限</span>
                <select v-model.number="cfg.actionTime">
                  <option :value="15">15 秒</option>
                  <option :value="30">30 秒</option>
                  <option :value="60">60 秒</option>
                  <option :value="0">不限时</option>
                </select>
              </label>
              <label class="field check"><input type="checkbox" v-model="cfg.rebuys" /><span>允许中途再买入</span></label>
            </div>
            <button class="btn gold" @click="createRoom">开局，发牌！</button>
          </div>

          <div class="card">
            <h3>加入房间</h3>
            <div class="join-row">
              <input v-model="joinCode" maxlength="6" placeholder="房间码，如 7K2MQF" class="join-code"
                     @keydown.enter="doJoin" />
              <button class="btn primary" @click="doJoin">加入</button>
            </div>
            <h3 class="mt">当前房间</h3>
            <div v-if="!S.lobbyRooms.length" class="empty-state">
              <div class="ico">♠</div>
              <div>还没有进行中的房间</div>
              <div class="sub">创建一个，把房间码发给朋友就能开局</div>
            </div>
            <div v-for="r in S.lobbyRooms" :key="r.code" class="room-row">
              <div class="room-info">
                <b>{{ r.name }}</b>
                <span class="room-code">{{ r.code }}</span>
                <span class="muted">{{ r.seated }}/9 人 · 盲注 {{ r.settings.sb }}/{{ r.settings.sb * 2 }}</span>
                <span v-if="r.playing" class="live-dot">对局中</span>
              </div>
              <button class="btn small" @click="joinFromList(r.code)">进入</button>
            </div>
          </div>
        </div>

        <!-- 战绩 -->
        <div v-else-if="tab === 'stats'" class="card stats-card">
          <div class="stats-head">
            <label class="field inline">
              <span>查看</span>
              <select v-model="selKey">
                <option v-for="p in playerOptions" :key="p.key" :value="p.key">{{ p.name }} #{{ p.number }}</option>
              </select>
            </label>
            <template v-if="profile">
              <div class="stat"><em>当前余额</em><b>{{ profile.chips.toLocaleString() }}</b></div>
              <div class="stat"><em>累计输赢</em><b :class="netWorth > 0 ? 'up' : netWorth < 0 ? 'down' : ''">{{ sgn(netWorth) }}</b></div>
              <div class="stat"><em>对局场次</em><b>{{ games }}</b></div>
            </template>
          </div>
          <TrendChart v-if="profile" :history="profile.history" />
          <div v-if="profile && profile.history.length > 1" class="history-table">
            <table>
              <thead><tr><th>时间</th><th>变动</th><th>余额</th><th>来源</th><th>备注</th></tr></thead>
              <tbody>
                <tr v-for="(h, i) in [...profile.history].reverse()" :key="i">
                  <td class="muted">{{ fmt(h.t) }}</td>
                  <td :class="h.delta > 0 ? 'up' : h.delta < 0 ? 'down' : ''">{{ sgn(h.delta) }}</td>
                  <td>{{ h.balance.toLocaleString() }}</td>
                  <td>{{ h.room || '—' }}</td>
                  <td class="muted">{{ h.note }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- 排行 -->
        <div v-else-if="tab === 'rank'" class="card">
          <h3>排行榜</h3>
          <table class="rank-table">
            <thead><tr><th>#</th><th>玩家</th><th>余额</th></tr></thead>
            <tbody>
              <tr v-for="(r, i) in rankRows" :key="r.key" :class="{ me: r.key === S.me.key }" @click="openProfileOf(r.key)">
                <td class="muted">{{ i + 1 }}</td>
                <td><b>{{ r.name }}</b> <span class="muted">#{{ r.number }}</span></td>
                <td :class="r.chips > 0 ? 'up' : r.chips < 0 ? 'down' : ''">{{ r.chips.toLocaleString() }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 管理 -->
        <div v-else-if="tab === 'admin'" class="admin-grid">
          <div class="card">
            <h3>添加玩家</h3>
            <div class="field-row">
              <label class="field"><span>名称</span><input v-model="addForm.name" maxlength="16" /></label>
              <label class="field"><span>编号</span><input v-model="addForm.number" type="number" min="0" max="999" /></label>
              <label class="field"><span>初始余额</span><input v-model="addForm.chips" type="number" step="100" /></label>
            </div>
            <button class="btn gold" @click="doAdd">添加</button>
            <h3 class="mt">修改管理员密码</h3>
            <div class="field-row">
              <label class="field"><span>新密码</span><input v-model="pwForm.a" type="password" /></label>
              <label class="field"><span>重复</span><input v-model="pwForm.b" type="password" /></label>
            </div>
            <button class="btn" @click="doSetPw">保存密码</button>
          </div>
          <div class="card">
            <h3>玩家名单（{{ S.adminPlayers.length }}）</h3>
            <div v-for="p in S.adminPlayers" :key="p.key" class="admin-row">
              <div class="admin-info">
                <b>{{ p.name }}</b> <span class="muted">#{{ p.number }}</span>
                <span class="admin-chips" :class="p.chips > 0 ? 'up' : p.chips < 0 ? 'down' : ''">{{ p.chips.toLocaleString() }}</span>
              </div>
              <div class="admin-ops">
                <button class="btn ghost small" @click="openProfileOf(p.key)">走势</button>
                <button class="btn ghost small" @click="startAdjust(p.key)">调整</button>
              </div>
              <div v-if="adjustKey === p.key" class="adjust-form">
                <input v-model="adjustDelta" type="number" placeholder="±额度，如 -500" />
                <input v-model="adjustNote" maxlength="40" placeholder="备注（可选）" />
                <button class="btn small gold" @click="doAdjust(p.key)">确认</button>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>
  `,
};
