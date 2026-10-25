# 德州之夜 · HOLD'EM NIGHT

多人在线德州扑克（无限注），专为朋友局设计：**无需注册**，名称 + 编号即身份（F1 风格），
战绩与筹码走势自动记账，界面为 Material 2 浅色风格，手机/电脑都能玩。

- 2–9 人同桌，官方规则（盲注、最小加注、全下边池、平分彩池与零头）
- 局结算制：开局统一发筹码，离桌自动按净输赢记入总余额（可为负，纯记分）
- 战绩页：余额、累计输赢、**筹码走势图**；排行榜
- 管理员白名单：只有 `max #33` 能添加玩家 / 调整筹码（密码保护）
- 房间聊天 + 完整行动日志；游戏内随时打开**规则手册**
- 行动倒计时（15/30/60 秒可配），超时自动过牌/弃牌；断线保留座位，重进自动回桌
- 数据存本地 JSON 文件（`data/`），无需数据库；服务器意外重启也会把桌面筹码结算入账

## 快速开始（本机试玩）

```bash
npm install
npm start          # 默认 http://localhost:3000
```

Windows 双击 `start.bat` 即可。

首次启动会自动创建管理员 `max #33`：
- 若未设置环境变量，控制台会打印一个**随机初始密码**（同时写入 `data/config.json`），登录后可在「管理」页修改；
- 推荐启动时直接指定：`ADMIN_PASSWORD=你的密码 npm start`。

**玩法**：管理员进入后在「管理」页添加朋友的「名称 + 编号」→ 朋友输入名称编号进入 →
一人「创建房间」→ 其他人用 6 位房间码（或邀请链接）加入 → 入座 → 房主点「开始游戏」。

## 内网对战（Radmin / ZeroTier / 局域网）

1. 房主启动服务器：`npm start`
2. 允许防火墙放行端口（管理员命令行，3000 可换）：

   ```bat
   netsh advfirewall firewall add rule name="Holdem Night" dir=in action=allow protocol=TCP localport=3000
   ```

3. 启动时控制台会打印本机所有 IPv4（含 Radmin/ZeroTier 虚拟网卡），例如：

   ```
   局域网/内网: http://26.x.x.x:3000   (Radmin VPN)
   ```

4. 把该地址发给朋友，浏览器直接打开即玩。断线刷新页面即可回到牌桌。

## 公网部署（有服务器 IP 即可）

```bash
# 服务器上（Linux 示例，80 端口）
sudo PORT=80 ADMIN_PASSWORD=你的密码 node server/index.js
```

常驻运行二选一：

```bash
# systemd（推荐）
sudo tee /etc/systemd/system/holdem.service <<'EOF'
[Unit]
Description=Holdem Night
After=network.target
[Service]
WorkingDirectory=/opt/holdem
Environment=PORT=80
Environment=ADMIN_PASSWORD=你的密码
ExecStart=/usr/bin/node server/index.js
Restart=always
[Install]
WantedBy=multi-user.target
EOF
sudo systemctl enable --now holdem
```

或 pm2：

```bash
npm i -g pm2
PORT=80 pm2 start server/index.js --name holdem
```

> 公网建议再套一层 nginx/Caddy 做 HTTPS/WSS 反代（WebSocket 已兼容），
> 或直接关闭 80 改用高位端口降低扫描噪音。

## Docker 部署

```bash
docker compose up -d --build        # http://服务器IP:3000
```

- 数据库卷挂载在 `./data`，备份这个目录即可迁移/备份全部档案
- 管理员密码：`ADMIN_PASSWORD=xxx docker compose up -d` 或留空看日志生成的初始密码

## 管理员（max #33）

- **添加玩家**：管理页 → 名称 + 编号 + 初始余额（默认 1000）
- **调整筹码**：任意玩家 ±额度（需备注，全部留痕进入走势）
- **改密码**：管理页底部；也可用环境变量 `ADMIN_PASSWORD` 固定
- 密码哈希存于 `data/config.json`，玩家档案存于 `data/players.json`

## 规则与结算要点（游戏内可随时查看完整手册）

- 每场对局：入座即买入一份房主设定的开局筹码；打光可在两手之间再买入
- **站起 / 离开 / 关房 / 服务器重启** 时结算：`净输赢 = 桌上筹码 − 买入次数 × 开局筹码`
- 余额可为负（纯记分），不影响继续游戏
- 旁观者看不到任何人的底牌；摊牌时未弃牌者自动亮牌
- 服务器意外退出：重启后按桌面筹码自动结算（历史备注「服务器重启」）

## 开发

```bash
npm test          # 单元测试（牌型评估 + 规则引擎）
npm run integrate # WebSocket 集成测试（完整对局/结算/管理员流程）
npm start         # 启动
```

技术栈：Node.js（仅依赖 `ws`）+ Vue 3（本地内置，离线可用）+ 原生 CSS。

## 常见问题

- **忘记管理员密码**：删除 `data/config.json` 后重启，会重新生成/打印初始密码（玩家档案不受影响）。
- **换端口**：环境变量 `PORT=8080 npm start`。
- **数据备份**：整个 `data/` 目录拷走即可。
