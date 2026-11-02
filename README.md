# LeonSSH

Windows 优先的可视化 SSH 客户端。**阶段 1–5 全部完成**：二进制字节流通道、russh 交互式 Shell、SQLite 会话 + 凭据管理器 + 多标签、SFTP 双面板、端口转发。

## 技术栈

| 层 | 选型 |
| --- | --- |
| 桌面框架 | Tauri 2.12.5 |
| 前端 | React 19.3 + TypeScript 6.0 + Vite 8.3 |
| 终端 | `@xterm/xterm` 6 + `@xterm/addon-fit` 0.11 + `@xterm/addon-webgl` 0.19 |
| 后端 | Rust 1.99（edition 2024）+ tokio 1.54 |
| SSH | russh 0.63.3（`ring` 后端）+ `russh-sftp` 3.0.1 |
| 存储 | `tauri-plugin-sql` 2（sqlx 0.8 / SQLite）+ `keyring` 4（Windows Credential Manager） |

> russh 从 0.65 降到 0.63.3 的原因：`russh-sftp` 依赖 `russh ^0.63`，这样 SFTP 才能复用**同一条** SSH 连接而不是另开连接或手写 SFTP 协议。

## 功能一览

| 阶段 | 能力 |
| --- | --- |
| 1 | `Channel<Raw>` 二进制输出通路、独立 write/resize 命令、有界队列背压、WebGL→DOM 回退 |
| 2 | 密码认证、PTY 协商、`window_change`、TOFU 主机密钥、内置 russh 测试服务器 |
| 3 | SQLite `sessions`/`known_hosts`、密码进 Windows 凭据管理器、多标签、连接表单、已知主机管理 |
| 4 | 同连接 SFTP 子系统、本地/远程双面板、上传下载（32 KiB 分块 + 进度）、删除/重命名/新建目录/改权限 |
| 5 | `-L` 本地转发、`-R` 远程转发、`-D` SOCKS5、规则随会话持久化、关闭自动回收 |

## 快速开始

```powershell
# 1. 启动真实 sshd 容器（Debian/Alpine + vim/htop/tmux，账号 test/test）
docker build -t leonssh-sshd:test docker/sshd
docker run -d --name leonssh-sshd --restart unless-stopped -p 2222:22 leonssh-sshd:test

# 2. 安装依赖并启动应用
pnpm install
pnpm tauri dev
```

首次启动进入「新建会话」表单，默认值已指向 `127.0.0.1:2222`；填密码 `test` 后点「创建并连接」。

## 构建产物

```powershell
pnpm tauri build
```

| 产物 | 路径 | 大小 |
| --- | --- | --- |
| 免安装可执行文件 | `src-tauri/target/release/leonssh.exe` | 13.67 MB |
| NSIS 安装包 | `src-tauri/target/release/bundle/nsis/LeonSSH_0.1.0_x64-setup.exe` | 3.65 MB |

安装包 `installMode: currentUser`，默认装到 `%LOCALAPPDATA%\LeonSSH`；卸载删除程序与快捷方式，保留 `data/`。

## 数据目录

**所有配置、缓存、日志、数据库、WebView2 数据都在安装目录下**：

```
<安装目录>/
├─ LeonSSH.exe
└─ data/
   ├─ leonssh.db       SQLite：sessions / known_hosts / forwards
   ├─ logs/            leonssh.log.YYYY-MM-DD
   ├─ cache/           预留
   └─ webview/         WebView2 用户数据目录
```

密码**不在**这里：`sessions.keyring_ref` 只是引用，真正的密码在 Windows 凭据管理器（服务名 `com.leonssh.app`）。
`tauri-plugin-sql` 默认会把 `sqlite:` 映射到 `%APPDATA%`，本项目改为由 Rust 在安装目录建池并注册进插件的 `DbInstances`，详见 `src-tauri/src/storage/mod.rs`。

## 测试

```powershell
cd src-tauri
cargo test                      # 43 个单元/集成测试
cargo test -- --ignored         # 4 个需要 docker sshd 的端到端测试
```

需要容器的四个：终端（颜色/htop/vim/tmux/resize）、SFTP 往返、端口转发（-L/-D）、种子脚本。

## 验收文档与截图

- [阶段 1](docs/phase-1-acceptance.md) · [阶段 2](docs/phase-2-acceptance.md) · [阶段 3](docs/phase-3-acceptance.md) · [阶段 4](docs/phase-4-acceptance.md) · [阶段 5](docs/phase-5-acceptance.md)
- 截图：[`docs/phase-2-docker-connect.png`](docs/phase-2-docker-connect.png)（真实 Alpine 会话）、[`docs/phase-3-sessions.png`](docs/phase-3-sessions.png)（侧边栏）、[`docs/phase-3-onboarding.png`](docs/phase-3-onboarding.png)（连接表单）

## 目录结构

```
src/                        前端：组件 / hooks / ipc 封装 / xterm 封装
src-tauri/src/
├─ commands/                IPC 表面：ssh / sessions / sftp / forward
├─ ssh/                     russh 连接、认证、TOFU、会话、内置测试服务器
├─ sftp/                    SFTP 子系统 + 本地目录
├─ forward/                 -L/-R/-D 运行时
├─ storage/                 SQLite（sessions / known_hosts / forwards）
├─ secure/                  Windows 凭据管理器
├─ terminal/                Channel sink / 有界队列 pump / 会话注册表
└─ paths.rs state.rs error.rs lib.rs
docker/sshd/                验收用真实 sshd 镜像
```

## 已知限制

- 仅密码认证（`auth_method`/`private_key_path` 字段已预留）
- SFTP 只做单文件传输，无目录递归/拖拽
- SOCKS5 无认证、无 UDP
- 标签页不跨重启恢复
- 本机 crates.io 连接不稳定：依赖通过镜像拉取后同步到 cargo 缓存（`tools/sync-cargo-cache.ps1`），项目本身不含镜像配置
