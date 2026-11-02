# LeonSSH

Windows 优先的可视化 SSH 客户端。**当前进度：阶段 1 — 字节流通路骨架（尚未接入 SSH）。**

阶段 1 的目标是把「终端字节如何从 Rust 到 xterm.js、键盘如何回 xterm → Rust、resize 如何独立传递」这条最关键的管道打通并验证，SSH 只是给它换一个数据源。

## 技术栈

| 层 | 选型 |
| --- | --- |
| 桌面框架 | Tauri 2.12.5 |
| 前端 | React 19.3 + TypeScript 6.0 + Vite 8.3 |
| 终端 | `@xterm/xterm` 6 + `@xterm/addon-fit` 0.11 + `@xterm/addon-webgl` 0.19 |
| 后端 | Rust 1.99（edition 2024）+ tokio 1.54 |
| SSH（阶段 2） | russh 0.65 |
| 存储（阶段 3） | `tauri-plugin-sql`（SQLite）+ `keyring` |

## 快速开始

```powershell
pnpm install
pnpm tauri dev          # 开发模式（Vite HMR + Rust 热重编译）
```

## 构建可执行文件与安装包

```powershell
pnpm tauri build
```

产物（阶段 1 已实测生成并验证）：

| 产物 | 路径 | 大小 |
| --- | --- | --- |
| 免安装可执行文件 | `src-tauri/target/release/leonssh.exe` | 7.96 MB |
| NSIS 安装包 | `src-tauri/target/release/bundle/nsis/LeonSSH_0.1.0_x64-setup.exe` | 1.99 MB |

安装包使用 `installMode: currentUser`，默认安装到 `%LOCALAPPDATA%\LeonSSH`。
卸载会删除程序与开始菜单快捷方式，但**保留 `data/` 目录**（日志与 WebView2 缓存属于用户数据）。

## 阶段 1 验收

- 验收清单：[`docs/phase-1-acceptance.md`](docs/phase-1-acceptance.md)
- 运行截图：[`docs/phase-1-screenshot.png`](docs/phase-1-screenshot.png)、[`docs/phase-1-input-resize.png`](docs/phase-1-input-resize.png)
- 自动化结果：`cargo test` 24/24 通过、`cargo check` 0 告警、`tsc --noEmit` 通过、`cargo build --release` + NSIS 打包成功

## 数据目录约定

**所有配置、缓存、日志、WebView2 数据都放在安装目录下**，不写 `%APPDATA%`、不写注册表：

```
<安装目录>/
├─ LeonSSH.exe
└─ data/
   ├─ logs/      leonssh.log.YYYY-MM-DD（tracing 滚动日志）
   ├─ cache/     预留（阶段 3+）
   └─ webview/   WebView2 用户数据目录（缓存/GPU/DevTools）
```

解析顺序（`src-tauri/src/paths.rs`）：

1. 环境变量 `LEONSSH_DATA_DIR`（便携/调试用）
2. `<exe 所在目录>/data`（默认）
3. 若安装目录只读（例如装进 `C:\Program Files`），回退到 `%LOCALAPPDATA%\LeonSSH\data`，并在日志与状态栏明确标注「已回退」

## 目录结构

```
src/                       前端
├─ components/             TerminalView / StatusBar（纯展示）
├─ hooks/useTerminal.ts    终端生命周期（唯一创建/销毁入口）
├─ lib/ipc/                invoke 命令的类型化封装 + 错误归一化
├─ lib/terminal/           xterm 封装、渲染器选择、主题
└─ styles/
src-tauri/src/             后端
├─ commands/ssh.rs         IPC 表面：ssh_open / ssh_write / ssh_resize / ssh_close
├─ terminal/               传输无关的会话层
│  ├─ sink.rs              OutputSink 抽象 + ChannelSink（二进制通道）
│  ├─ pump.rs              有界队列 → 聚合 → IPC 推送
│  ├─ fake_source.rs       阶段 1 假数据源（阶段 2 替换为 russh 读取循环）
│  ├─ registry.rs          SessionHandle + 协作式关闭
│  └─ input.rs             按键日志脱敏
├─ paths.rs                安装目录数据根 + 日志初始化
├─ state.rs                AppState / 会话注册表
├─ error.rs                AppError → { code, message }
└─ lib.rs                  Builder 装配（保持薄）
```

## 阶段 1 的三个通道

| 通道 | 方向 | 机制 |
| --- | --- | --- |
| 输出 | Rust → JS | `Channel` 发送 `InvokeResponseBody::Raw`，前端收到 `ArrayBuffer`，**不经过 JSON** |
| 输入 | JS → Rust | `invoke("ssh_write", { sessionId, data })`，量小，允许 JSON |
| 控制 | JS → Rust | `invoke("ssh_resize", { sessionId, cols, rows })`，走 `watch` 通道，绝不混入数据流 |

输出侧还有两层保护：

- 生产者 → `mpsc::channel(256)` 有界队列，满则阻塞（背压一路传回数据源）
- pump 把队列中已就绪的数据聚合成 ≤64 KiB 的帧再发，降低 IPC 次数

## 渲染器策略

1. 启动时探测 `webgl2` 上下文；
2. 可用则加载 `@xterm/addon-webgl`，不可用则停留 DOM 渲染器；
3. 运行中监听 `onContextLoss`，销毁 addon 无缝回退 DOM —— 滚动缓冲区在 xterm 的终端模型里，不在渲染器里，因此不会丢。

## 测试

```powershell
cd src-tauri; cargo test        # 会话注册表、关闭超时、聚合、假数据帧、路径、错误序列化
pnpm exec tsc --noEmit          # 前端类型检查
```

## 排错

| 现象 | 处理 |
| --- | --- |
| 启动无窗口 | 看 `<安装目录>/data/logs/leonssh.log.*` 是否有 `main window created` |
| 端口被占用 | `tauri dev` 固定 1420，先关掉占用进程 |
| 数据跑到了 LOCALAPPDATA | 安装目录不可写，查看状态栏是否显示「已回退」 |
| 终端空白 | DevTools 看 `ssh_open` 是否报错；检查 `webgl2` 是否可用 |

## 路线图

- [x] 阶段 1 字节流通路骨架
- [ ] 阶段 2 russh 交互式 shell（密码认证、PTY、resize）
- [ ] 阶段 3 会话持久化 + TOFU 主机密钥 + keyring + 多标签
- [ ] 阶段 4 复用同一连接的 SFTP 双面板
- [ ] 阶段 5 端口转发（-L / -R / -D）
