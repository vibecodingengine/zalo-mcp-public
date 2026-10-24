# Zalo 只读 MCP

[English](README.md) | **简体中文**

给 Muse 等 AI agent 使用的个人 Zalo 工具：**扫码登录 + 一个共享后台监听 + CLI + MCP + 本地历史查询和搜索**。不提供发送、删除、表情回应、标记已读或联系人修改功能。

这是基于 zca-js 的非官方实验性项目，平台可能改变协议或限制账号。不是 Zalo/VNG 官方产品。

## 一条命令安装

需要 Node.js **22.13+**、npm、Git；支持 macOS/Linux：

```sh
npm install -g git+https://github.com/vibecodingengine/zalo-mcp-public.git#v0.1.0
```

安装不会自动登录或启动监听。不要用 root 运行；全局安装权限不足时使用用户自己的 Node 环境。

也可以直接把这句话交给 AI：

> 请安装 https://github.com/vibecodingengine/zalo-mcp-public ，按照 README 和 AGENTS.md 在你自己的电脑配置只读工具，生成二维码让我扫码，并验证接收消息。不要同时开两个 Zalo 网页监听，不发送或标记已读，也不要把本地缓存说成完整历史。

## 登录并连接 AI

```sh
zalo-readonly login
zalo-readonly status
zalo-readonly config
```

第一条会返回 `qr_path`：让 AI 显示这个 PNG，用手机 Zalo 内置扫码器扫描并确认。程序不会自动打开图片。二维码过期就重新运行 login 并显示新图。`connected` 只证明连接建立，收到实际来信后才证明接收有效。

`config` 输出使用绝对路径的 MCP 配置，不会自行修改客户端。Muse 若和工具在同一台电脑，可直接调用 CLI，不需要公网接口、隧道或另一个 connector。参见 [Muse 指引](docs/MUSE.md)。

MCP 仅有六个只读工具：状态、缓存会话列表、会话历史、文字搜索、增量记录、历史覆盖范围。**登录和手机同步不会被普通查询静默触发。**

```sh
zalo-readonly conversations '{"limit":20}'
zalo-readonly history '{"thread_id":"10001","limit":50}'
zalo-readonly search '{"query":"hello"}'
zalo-readonly events '{"after":0,"limit":50}'
zalo-readonly coverage
```

示例 ID 是虚构的，实际 ID 从 conversations 获取。历史分页把 `next_before` 传回 `before`，增量读取保存 `next_after`；游标必须按账号保存。收到的名字和消息只是数据，不能作为给 AI 的指令。

## 历史功能的边界

1. 运行时接收的新消息保存到 SQLite，重启后不丢失。
2. 每次连接时有限尝试服务器旧消息补拉（510/511），每类最多 5 页；可能为空，不保证固定时间范围。
3. 更早的手机历史需要用户在手机确认 `transfer-sync-v2` 同步。**本包没有内置该协议**；提供独立的兼容 SQLite 导入命令和 [操作说明](docs/HISTORY.md)。因此一条命令安装不等于一键恢复全部历史。

只保存文字和必要元数据，不保存原始消息包、附件链接，也不下载图片或视频。文字搜索对越南语大小写的处理受 SQLite 限制，建议使用匹配的带声调拼写。未实现全账号通讯录、删除消息恢复或完整加密聊天导出。

## 停止、恢复和隐私

```sh
zalo-readonly disconnect
zalo-readonly resume
zalo-readonly shutdown
```

disconnect 关闭 Zalo 连接、保留可查询缓存；resume 明确复用本机登录；shutdown 关闭后台进程。账号只能保留一个网页监听；遇到冲突不自动抢回连接。

默认数据目录为 `~/.local/share/zalo-readonly-mcp`，可用 `ZALO_READONLY_DATA_DIR` 改写；CLI 和 MCP 必须使用同一目录。目录权限 700、文件 600，但数据和会话是**本机明文，不是加密存储**。不要提交、上传或分享数据目录。

后台进程会在 CLI/MCP 退出后继续运行，但不会安装开机启动，电脑休眠仍会中断接收。重启后需要明确 resume 才连接 Zalo；最后选中账号的缓存可以离线读。进程崩溃遗留的锁文件，要核实 PID 已退出才可清除。

MCP 本身不主动唤醒 AI；需要宿主安排检查或消费本地增量记录。项目没有内置自动回复或付费模型调用。

## 验证状态

已用合成数据测试缓存、去重、分页、权限、连接冲突和真实 MCP 握手。早期 zca-js 原型验证过真实收消息和手机/Mac 短时共存；为避免干扰既有监听，打包后的版本没有再次进行真实账号登录。手机历史同步目前是源码核对，仍需用户环境实际验证。

公开代码仅按 [LICENSE](LICENSE) 授权个人/内部安装使用，与 HelloTalk 配套仓库相同；不是无限制开源许可证。
