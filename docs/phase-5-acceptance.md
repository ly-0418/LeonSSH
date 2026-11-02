# 阶段 5 验收清单

> 目标：在已有 SSH 连接上提供 -L（本地）、-R（远程）、-D（SOCKS5）转发，配置随会话持久化，会话关闭自动回收。

## 0. 已由开发侧验证

| 项目 | 结果 | 证据 |
| --- | --- | --- |
| -L 本地转发 | 监听本机端口 → `channel_open_direct_tcpip` → 远端服务；测试读到了容器 sshd 的 `SSH-2.0-` banner | `cargo test -- --ignored real_ssh_local_and_socks_forwarding` |
| -D SOCKS5 | 无认证握手 + CONNECT 127.0.0.1:22，同样读到 `SSH-2.0-` banner | 同上 |
| -R 远程转发 | `tcpip_forward` 申请服务端监听；`forwarded-tcpip` 通道由 `ClientHandler` 桥接到本地目标 | 代码路径 + 手动验收（见下） |
| 规则持久化 | `forwards` 表按 `session_id` 外键，删除会话级联删除规则 | `cargo test storage::forwards`（3 个测试） |
| 会话关闭回收 | `ssh_close` → `stop_all_for_terminal`；窗口关闭 → `stop_all` | `commands/ssh.rs`、`lib.rs` |
| 监听释放 | `ForwardManager::stop` 停止 accept 循环、取消远端监听、2s 超时后回收 | `forward/mod.rs` |

> 注：真实 sshd 容器默认 `AllowTcpForwarding no`（Alpine 的 sshd_config 显式写了 no），已在 `docker/sshd/Dockerfile` 里改成 `yes`，否则 -L/-D 会被服务端拒绝。

## 1. 手动验收步骤

```powershell
docker start leonssh-sshd
pnpm tauri dev
```

1. 连接一个会话，终端出现 `$`。
2. 点标签栏「转发」→ 打开端口转发面板。

### -L 本地转发

- 规则：`-L 8080 → 127.0.0.1:22`，点「启动」。
- 在 PowerShell 里：`Test-NetConnection 127.0.0.1 -Port 8080` → `TcpTestSucceeded : True`
- 或者 `ssh -p 8080 test@127.0.0.1`（密码 test）能连上容器。

### -D SOCKS5

- 规则：`-D 1080`，点「启动」。
- 浏览器/工具设置 SOCKS5 代理 `127.0.0.1:1080` 后能访问远端可达的地址。

### -R 远程转发

- 规则：`-R 127.0.0.1:9000 → 127.0.0.1:<本机某端口>`，点「启动」。
- 在容器内访问 `127.0.0.1:9000` 会转发回你本机的目标端口。

### 回收

- [ ] 点「停止」后，`Test-NetConnection 127.0.0.1 -Port 8080` 失败（端口释放）
- [ ] 关闭该终端标签 → 所有相关转发停止（日志 `forward stopped` / 端口不再监听）
- [ ] 重启应用后规则仍在（`forwards` 表），默认不自动启动

## 2. 实现要点

- **同连接**：`ForwardManager` 使用终端注册的 `Arc<russh::client::Handle>`，不新建 SSH 连接。
- **-R 路由表**：`RemoteRoutes = Arc<Mutex<HashMap<(addr,port),(target_host,target_port)>>>`，连接建立时注入 `ClientHandler`；
  服务端发来 `forwarded-tcpip` 时查表并桥接到本地目标，查不到直接拒绝。
- **SOCKS5**：只支持无认证 + CONNECT（浏览器常用模式），失败按协议返回错误码。
- **生命周期**：转发规则存 SQLite；运行态在内存；终端关闭/窗口退出都会调用 `stop_all*`，端口一定释放。

## 3. 已知限制

- SOCKS5 不支持用户名密码认证与 UDP ASSOCIATE
- -R 未纳入自动化测试（需要容器内主动发起连接），仅做了代码路径与手动验收说明
- 规则不区分多标签：同一会话的两个终端各自可启动相同规则，端口冲突会在启动时报错
