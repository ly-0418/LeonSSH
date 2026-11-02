# LeonSSH

Windows 优先的可视化 SSH 客户端。**当前进度：阶段 2 — russh 交互式 Shell 已跑通。**

阶段 1 打通了「字节流不许走 JSON」的管道；阶段 2 把假数据源换成了真实的 russh 连接：主机密钥 TOFU 校验、密码认证、PTY 协商、交互式 shell、窗口 resize 全部接上，并附带一个内置的 russh 测试服务器（无需 Docker / WSL / 管理员权限即可验收）。

## 技术栈

| 层 | 选型 |
| --- | --- |
| 桌面框架 | Tauri 2.12.5 |
| 前端 | React 19.3 + TypeScript 6.0 + Vite 8.3 |
| 终端 | `@xterm/xterm` 6 + `@xterm/addon-fit` 0.11 + `@xterm/addon-webgl` 0.19 |
| 后端 | Rust 1.99（edition 2024）+ tokio 1.54 |
| SSH | russh 0.65（`ring` 加密后端，默认关闭 `aws-lc-rs`）|
| 存储（阶段 3） | `tauri-plugin-sql`（SQLite）+ `keyring` |

## 快速开始

```powershell
pnpm install

# 终端 A：启动内置测试 SSH 服务器（127.0.0.1:2222，用户 test / 密码 test）
cargo run --manifest-path src-tauri/Cargo.toml --features test-server --bin ssh-test-server

# 终端 B：启动应用
pnpm tauri dev
```

应用默认连接 `127.0.0.1:2222`（阶段 2 的固定配置）。连真实服务器时用环境变量覆盖：

```powershell
$env:LEONSSH_SSH_HOST="192.168.1.10"
$env:LEONSSH_SSH_PORT="22"
$env:LEONSSH_SSH_USER="root"
$env:LEONSSH_SSH_PASSWORD="..."
pnpm tauri dev
```

> 阶段 2 用环境变量传密码只是过渡；阶段 3 会改成表单 + Windows 凭据管理器（keyring），SQLite 只存引用键。

## 构建可执行文件与安装包

```powershell
pnpm tauri build
```

| 产物 | 路径 | 大小 |
| --- | --- | --- |
| 免安装可执行文件 | `src-tauri/target/release/leonssh.exe` | 9.82 MB |
| NSIS 安装包 | `src-tauri/target/release/bundle/nsis/LeonSSH_0.1.0_x64-setup.exe` | 2.48 MB |

安装包 `installMode: currentUser`，默认装到 `%LOCALAPPDATA%\LeonSSH`；卸载会删除程序与快捷方式，保留 `data/`（用户数据）。

## 验收与截图

- 阶段 1 验收：[`docs/phase-1-acceptance.md`](docs/phase-1-acceptance.md)
- 阶段 2 验收：[`docs/phase-2-acceptance.md`](docs/phase-2-acceptance.md)
- 截图：
  - [`docs/phase-2-shell.png`](docs/phase-2-shell.png) — 真实 SSH 会话里执行 `ls --color` / `size`
  - [`docs/phase-2-htop.png`](docs/phase-2-htop.png) — 测试服务器的假全屏程序随 PTY 尺寸重绘
  - [`docs/phase-1-screenshot.png`](docs/phase-1-screenshot.png) — 阶段 1 ANSI 色板

自动化结果：`cargo test` 37/37（含 4 个真实 SSH 集成测试）、`cargo check` 0 告警、`tsc --noEmit` 通过、release + NSIS 打包成功。

## 数据目录约定

**所有配置、缓存、日志、WebView2 数据都放在安装目录下**，不写 `%APPDATA%`：

```
<安装目录>/
├─ LeonSSH.exe
└─ data/
   ├─ logs/            leonssh.log.YYYY-MM-DD（tracing 滚动日志）
   ├─ known_hosts.json TOFU 指纹（阶段 2 先用 JSON，阶段 3 迁到 SQLite）
   ├─ cache/           预留（阶段 3+）
   └─ webview/         WebView2 用户数据目录（缓存/GPU/DevTools）
```

解析顺序（`src-tauri/src/paths.rs`）：`LEONSSH_DATA_DIR` → `<exe 目录>/data` → 安装目录只读时回退 `%LOCALAPPDATA%\LeonSSH\data` 并在状态栏标红。

## 目录结构

```
src/                          前端
├─ components/                TerminalView / StatusBar（纯展示）
├─ hooks/useTerminal.ts       终端生命周期（唯一创建/销毁入口）
├─ lib/ipc/                   invoke 命令封装 + 错误归一化
└─ lib/terminal/              xterm 封装、WebGL 回退、主题

src-tauri/src/
├─ commands/ssh.rs            IPC 表面：ssh_open / ssh_write / ssh_resize / ssh_close
├─ ssh/
│  ├─ config.rs               固定连接配置 + 环境变量覆盖（Debug 自动脱敏）
│  ├─ hostkey.rs              TOFU 指纹计算、持久化、比对
│  ├─ client.rs               russh 连接 + 主机密钥校验 + 密码认证
│  ├─ session.rs              PTY / shell 通道 / 双向字节泵
│  └─ test_server.rs          内置 russh 测试服务器（feature = "test-server"）
├─ terminal/                  传输无关的会话层（sink / pump / registry / fake_source）
├─ paths.rs                   安装目录数据根 + 日志初始化
├─ state.rs                   AppState / 会话注册表
├─ error.rs                   AppError → { code, message }
└─ lib.rs                     Builder 装配（保持薄）
```

## 三条链路（阶段 1 定下，阶段 2 沿用到 SSH）

| 通道 | 方向 | 机制 |
| --- | --- | --- |
| 输出 | Rust → JS | `Channel` 发送 `InvokeResponseBody::Raw`，前端收 `ArrayBuffer`，**不经过 JSON** |
| 输入 | JS → Rust | `invoke("ssh_write", { sessionId, data })`，量小，允许 JSON |
| 控制 | JS → Rust | `invoke("ssh_resize", …)` → `watch` 通道 → russh `window_change` |

输出侧双重保护：生产者写入 `mpsc(256)` 有界队列（满则阻塞，反压到 TCP），pump 聚合 ≤64 KiB 再发。

## 渲染器策略

WebGL2 可用则加载 `@xterm/addon-webgl`；运行中 `onContextLoss` 时销毁 addon 无缝回退 DOM（滚动缓冲区在终端模型里，不丢数据）。

## 测试

```powershell
cd src-tauri; cargo test        # 37 个测试：单元 + 4 个真实 SSH 集成测试
pnpm exec tsc --noEmit
```

集成测试用内置 russh 服务器覆盖：首次连接记录指纹、指纹变更被拒、错误密码被拒、shell 回显与 PTY 尺寸跟随。

## 排错

| 现象 | 处理 |
| --- | --- |
| 终端显示「无法连接 127.0.0.1:2222」 | 没启动测试服务器，见上面「快速开始」 |
| 终端显示「主机密钥不匹配」 | 服务器换过密钥；删除 `data/known_hosts.json` 对应条目后重连 |
| 启动无窗口 | 看 `<安装目录>/data/logs/leonssh.log.*` |
| 数据跑到了 LOCALAPPDATA | 安装目录不可写，状态栏会标红提示 |

## 路线图

- [x] 阶段 1 字节流通路骨架
- [x] 阶段 2 russh 交互式 shell（密码认证、PTY、resize、TOFU）
- [ ] 阶段 3 会话持久化 + SQLite known_hosts + keyring + 多标签 + 连接表单
- [ ] 阶段 4 复用同一连接的 SFTP 双面板
- [ ] 阶段 5 端口转发（-L / -R / -D）
