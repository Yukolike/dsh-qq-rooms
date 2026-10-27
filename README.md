# dsh-qq-rooms

> **来源与致谢**：本项目衍生自 [dsh-qq-bridge](https://github.com/Yuuyuko-uu/dsh-qq-bridge)
> （作者 [Yuuyuko-uu](https://github.com/Yuuyuko-uu)，MIT）。
> `src/transport.js` 中的消息段解析、标记剥离、卡片抽取、正文图、转发展开等函数移植自原项目并做了修改；
> 房间模型、白/黑名单、群策略、插件装配为本项目新写。
> 本项目是独立的第三方项目，**不是原项目的官方分支**；插件 id（`qq-rooms`）与配置格式均不同，
> 不能与原版同时启用。原项目版权声明见 [LICENSE](./LICENSE)。

DSH 的 QQ 房间插件：**聊天即房间**，不用再手动把 QQ 会话绑到 DSH 会话。

- 私聊一人一间，群一群一间，第一条消息自动建房，之后复用（进程重启后 `resume`）
- 白名单直接聊；陌生人先问主人；主人拒绝后进黑名单，**以后不再询问**
- 群默认不接；接入后只回「@ 我 / 引用我」，**主人在群里免 @**
- 收图、发图、合并转发、卡片解析、语音转写（可选外部命令）

消息走 **OneBot 11 HTTP**（NapCat / SnowLuma 都行），入站以 **WebSocket 上报**为主、HTTP 轮询补漏。

## 安装

前提：本机已经跑着一个 OneBot 11 后端，并且开了

- HTTP 服务（默认 `http://127.0.0.1:3000`）
- WebSocket 上报（默认 `ws://127.0.0.1:3001`，陌生私聊只能靠它发现）

```bash
dsh plugin --profile desktop add github:Yukolike/dsh-qq-rooms
```

装完重启一次 DSH，然后 **设置 → 通到 QQ**。

> 与 `dsh-qq-bridge` 不兼容：两个都启用会双发。请只留一个。

## 配置

| 项 | 默认 | 说明 |
|---|---|---|
| 总开关 | 关 | 关 = 一句都不发 |
| 试运行 | 开 | 开 = 只记账，不真发 |
| 主人 | 空 | 管理员的 QQ 号；审批、加群、重置只认这个号 |
| NapCat 地址 | `http://127.0.0.1:3000` | OneBot HTTP |
| 接口令牌 | 空 | 后端开了鉴权才填 |
| 事件地址 | `ws://127.0.0.1:3001` | 留空 = 不连事件源（只剩轮询） |
| 事件令牌 | 空 | 可空 |
| 房间工作区 | 空 | 新房间的 cwd；空 = `~/.dsh/qq-rooms` |
| 模型 | `deepseek-account/deepseek-flash` | `provider/model` |
| 访客工具 | `none` | 访客房间的工具：`none` / `safe` / `standard` |
| 只发 [QQ] 块 | 关 | 开 = 只发正文里 `[QQ]…[/QQ]` 中间那段 |

配置文件在 `~/.dsh/qq-rooms-config.json`，状态在 `~/.dsh/qq-rooms-state.json`。

## 主人指令（只在自己的私聊里生效）

```
同意 [号]          进白名单（以后直接聊）
拒绝 [号]          进黑名单（以后不再问你）
解除 10001         移出黑名单（下次会重新问）
放行 10001         直接进白名单

接群 123456789 [mention|all]
退群 123456789
静音 123456789 2h
取消静音 123456789

房间               列出所有房间
重置 群:123456789  归档会话，下次消息重建
```

指令必须整条消息匹配，日常聊天不会被误吃。

## 群策略

- 默认：**一个群都不接**，未加入的群消息直接丢弃，也不会来问你
- `mention`（默认）：只处理 @ 我 / 引用我的消息；`at all` 不算
- `all`：所有消息都进，交给模型判断
- 主人在群里说话：无视模式直接进
- 成员白/黑名单：`members.allow` 为空表示不限制，`deny` 优先

## 发表情包

在 `[QQ]` 块里写 `![随便起个名](_stickers/文件名)`，插件会读本地文件、以 base64 发出去，markdown 不会泄露到 QQ。

相对路径按 **图片根目录 → 房间工作区 → 进程 cwd → `~/.dsh`** 依次查找；也可以直接用绝对路径或 `http(s)` 链接。

## 安全

- **访客房间默认零工具**：建房后调用 `agent.ctx.tools.restrict({ allow: [] })`，模型请求头里的 `tools` 为 0，只能打字。主人私聊与群不受影响。
- `访客工具` 可设 `none`（默认，全禁）/ `safe`（只留 `todo_write`）/ `standard`（不限制，不推荐）。
- 这是 **agent 级运行时掩码**，不是 profile 隔离；`房间工作区` 仍建议指向空目录。
- 默认总开关关、试运行开，装完不会立刻发消息。

## 开发

```bash
node --test tests/*.test.mjs
```

测试使用假 ctx / 假 fetch，不需要 DSH 或 QQ 后端。

## 来源

`src/transport.js` 的部分纯函数（标记剥离、卡片抽取、正文图、消息段解析）移植自
[dsh-qq-bridge](https://github.com/Yuuyuko-uu/dsh-qq-bridge)（MIT）。房间、策略、装配、白/黑名单为本项目实现。

## License

MIT
