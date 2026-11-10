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
| 6 | 双栏文件管理器：本地（plugin-fs）/远程（同连接 SFTP）、256 KiB 流式传输、**断点续传**、任务队列、拖拽上传、远程在线编辑（CodeMirror 6） |

## 下载

👉 **[前往 GitHub Releases 下载最新版本](https://github.com/ly-0418/LeonSSH/releases/latest)**

每个 Release 提供两个文件：

| 文件 | 说明 |
| --- | --- |
| `LeonSSH_<版本>_x64-setup.exe` | NSIS 安装包（推荐），`currentUser` 安装到 `%LOCALAPPDATA%\LeonSSH` |
| `leonssh.exe` | 免安装绿色版，双击即可运行（数据仍写在同目录 `data/`） |

历史版本、更新说明都在 [Releases 页面](https://github.com/ly-0418/LeonSSH/releases)。

应用启动约 5 秒后会静默检查一次新版本（只读取版本号，不自动下载），发现更新时弹窗展示更新说明；也可以在 设置 → 配置参数 → 版本与更新 里手动检查。
窗口为**无边框**设计：应用顶栏即标题栏（按住可拖动、双击最大化），右上角自绘最小化 / 最大化-还原 / 关闭。

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

## 构建与发布

```powershell
pnpm build:release   # tauri build + 复制产物到 release/
```

`pnpm build:release` 会把 `src-tauri/target/release` 下的 exe 与当前版本的安装包复制到项目根目录 `release/`（该目录不入库）。

发布新版本：

1. 修改 `package.json` / `src-tauri/tauri.conf.json` / `src-tauri/Cargo.toml` 的版本号；
2. `pnpm build:release`；
3. 在 GitHub 创建 tag（如 `v0.4.12`）并新建 Release，上传 `release/` 里的两个文件：
   - `leonssh.exe`
   - `LeonSSH_<版本>_x64-setup.exe`

脚本化发布（需要已登录的 [GitHub CLI](https://cli.github.com/)）：

```powershell
pwsh scripts/publish-release.ps1 -Notes "本版更新说明"
```

未安装 gh 时脚本会打印手动发布步骤，会上传 `release/` 里的两个文件并创建对应 tag。

> 仓库不存放二进制产物，避免 git 历史随版本膨胀；`README` 的下载入口始终指向 Releases。

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
   ├─ edit/            远程在线编辑的临时工作区（退出时清理）
   └─ webview/         WebView2 用户数据目录
```

密码**不在**这里：`sessions.keyring_ref` 只是引用，真正的密码在 Windows 凭据管理器（服务名 `com.leonssh.app`）。
`tauri-plugin-sql` 默认会把 `sqlite:` 映射到 `%APPDATA%`，本项目改为由 Rust 在安装目录建池并注册进插件的 `DbInstances`，详见 `src-tauri/src/storage/mod.rs`。

## 测试

```powershell
cd src-tauri
cargo test                      # 53 个单元/集成测试
cargo test -- --ignored         # 7 个需要 docker sshd 的端到端测试
```

需要容器的七个：终端（颜色/htop/vim/tmux/resize）、SFTP 往返、端口转发（-L/-D）、种子脚本、
传输断点续传（上传+下载）、600 MB 流式上传、远程编辑往返（打开/保存/另存为/清理）。

## 文件管理器（增量阶段 A–D）

| 阶段 | 能力 | 验收 |
| --- | --- | --- |
| A | 双栏骨架 + 本地浏览（`@tauri-apps/plugin-fs`，盘符/路径栏/多选） | [fm-phase-a](docs/fm-phase-a.md) |
| B | 远程 SFTP 列表（同一条 SSH 连接）、权限列、Rust 侧排序、路径守卫 | [fm-phase-b](docs/fm-phase-b.md) |
| C | 256 KiB 流式上传下载、断点续传、队列（进度/速度/取消）、拖拽、双击下载 | [fm-phase-c](docs/fm-phase-c.md) |
| D | 远程在线编辑：临时目录 + CodeMirror 6 + 另存为 + 一致性校验 | [fm-phase-d](docs/fm-phase-d.md) |

自动化/调试用深链（正常启动不受影响）：

```powershell
$env:LEONSSH_START_VIEW = "files"          # 直接打开文件管理视图
$env:LEONSSH_START_LOCAL = "C:\Windows"    # 左栏初始目录
$env:LEONSSH_AUTO_SESSION = "2"            # 自动连接 sessions 表里 id=2 的会话
```

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

- 支持密码与私钥认证；私钥口令同样存入 Windows 凭据管理器
- SFTP 支持文件与整个文件夹递归传输，暂不支持跨会话队列持久化/历史记录
- SOCKS5 无认证、无 UDP
- 标签页不跨重启恢复
- 本机 crates.io 连接不稳定：依赖通过镜像拉取后同步到 cargo 缓存（`tools/sync-cargo-cache.ps1`），项目本身不含镜像配置
