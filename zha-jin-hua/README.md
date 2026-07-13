# 金局 · 炸金花

一个可在电脑和手机浏览器运行的炸金花小游戏，包含单机 AI 对战与实时联网房间。项目只使用游戏内虚拟筹码，不涉及充值、提现或真钱交易。

## 游戏模式

- 单机对战：你与三位不同风格的 AI 玩家同桌。
- 联网房间：输入昵称创建房间，将六位房间码分享给好友；支持 2～6 人。

采用常见简化规则：每人三张牌，牌型从大到小为豹子、同花顺、同花、顺子、对子、单张；A23 是最小顺子，QKA 是最大顺子；花色不分大小；不启用特殊 235。每局自动收取 10 个虚拟筹码底注。

## 本地运行

需要 Node.js 22 或更高版本。

```bash
npm ci
npm run dev
```

浏览器打开 `http://localhost:5173`。开发模式会同时启动 Vite 页面服务和 Socket.IO 实时服务。

同一局域网的手机可访问 `http://电脑局域网IP:5173`。电脑防火墙需要允许 Node.js 入站连接；手机和电脑必须连接同一网络。

## 测试与构建

```bash
npm test
npm run typecheck
npm run test:e2e
npm run build
```

端到端测试使用 Chromium，首次运行如缺少浏览器可执行：

```bash
npx playwright install chromium
```

生产构建由一个 Node.js 进程同时提供网页、健康检查和 WebSocket：

```bash
npm run build
npm start
```

默认地址为 `http://localhost:3001`，也可以通过 `PORT` 指定端口，例如 `PORT=4173 npm start`。服务监听 `0.0.0.0`，因此也可通过 `http://电脑局域网IP:端口` 从手机访问。健康检查位于 `/healthz`。

## Render 公网部署

仓库内的 `render.yaml` 定义了支持 WebSocket 的 Render Web Service。若本项目位于仓库的 `zha-jin-hua/` 子目录，请在 Render 创建 Blueprint 时选择仓库根目录下的 `zha-jin-hua/render.yaml`：

1. 将当前分支推送到 GitHub 或 GitLab。
2. 在 Render 控制台选择 **New → Blueprint**，连接仓库并指定 Blueprint 文件路径。
3. 确认服务使用 `npm ci && npm run build` 构建、使用 `npm start` 启动。
4. 等待 `/healthz` 通过后，打开 Render 提供的 HTTPS 地址。
5. 用两个独立浏览器或两台设备创建与加入同一房间，完成一局并刷新一次页面验证恢复。

Render 公网 WebSocket 会自动使用 `wss://`。免费实例闲置后可能休眠，首次访问需要等待唤醒。

## 运行限制

- 每次行动限时 30 秒；超时会由服务器自动弃牌。
- 断线座位保留 60 秒；在此时间内使用原浏览器返回可恢复房间。
- 房间和筹码只保存在服务器内存中，服务器重启或重新部署后会丢失。
- 单个服务实例适合测试和小规模朋友对局；多实例部署需要增加共享房间存储与 Socket.IO 适配器。
- 所有筹码均为虚拟筹码，本项目仅用于功能与模型能力测试。
