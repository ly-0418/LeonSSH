# 阶段 2 验收清单

> 目标：把阶段 1 的假数据源替换为真实 russh 连接，验证认证、主机密钥校验、PTY 协商、双向字节流与 resize。

## 0. 已由开发侧实测通过

| 项目 | 结果 | 证据 |
| --- | --- | --- |
| SSH 连接与认证 | `SSH authentication succeeded target=test@127.0.0.1:2222` | 运行日志 |
| 主机密钥 TOFU | 首次 `verdict=FirstUse accept=true`，重启后 `verdict=Match` | 运行日志 |
| 伪造指纹被拒 | 集成测试 `rejects_a_changed_host_key` 通过 | `cargo test` |
| 错误密码被拒 | 集成测试 `rejects_a_wrong_password` 通过 | `cargo test` |
| PTY + shell 通道 | `shell channel opened … cols=141 rows=34 term=xterm-256color` | 运行日志 |
| 窗口缩放传递 | 窗口变化后服务端收到 `window_change`，回显 `[pty resized to 136×35]` | `docs/phase-2-shell.png` |
| 命令交互 | `ls --color` 彩色输出、`size` 返回 `pty = 136×35` | `docs/phase-2-shell.png` |
| 全屏程序重绘 | 假 `htop` 面板随 PTY 尺寸重绘 | `docs/phase-2-htop.png` |
| 输入通路 | 每次按键 `terminal input … preview=...`（逐字节到达 Rust 并转发） | 运行日志 |
| 自动化测试 | 37/37 通过（含 4 个真实 SSH 集成测试） | `cargo test` |
| 编译告警 | `cargo check` 0 warning，`tsc --noEmit` 通过 | 构建日志 |
| 交付物 | `leonssh.exe` 9.82 MB、NSIS 安装包 2.48 MB | `pnpm tauri build` |

## 1. 环境准备

阶段 2 的测试目标是**内置 russh 测试服务器**（本机没有 Docker Desktop 且无管理员权限安装 WSL2，因此未使用 Docker）：

```powershell
cargo run --manifest-path src-tauri/Cargo.toml --features test-server --bin ssh-test-server
```

输出：

```
┌─ LeonSSH test SSH server ────────────────────────────
│ listening : 127.0.0.1:2222
│ user/pass : test / test
│ host key  : SHA256:fQYsPiKE822SlsV6vOY3b44b5eIsP8KDxxpIfbOPMBc
```

另开一个终端：

```powershell
pnpm tauri dev
```

## 2. 连接与认证

- [ ] 应用启动后终端出现绿色 banner：`LeonSSH Test SSH Server russh 0.65 · W×H`
- [ ] 出现提示符 `test@leonssh:~$`
- [ ] 状态栏显示 `已就绪 / 渲染器 WebGL2 / PTY W×H / session s1 / 127.0.0.1:2222`
- [ ] `<安装目录>/data/known_hosts.json` 生成，内容含 `"127.0.0.1:2222": "SHA256:fQYs…"`
- [ ] 关闭应用再启动，日志中 `verdict=Match`（不再提示首次使用）

## 3. 命令与渲染

在终端里逐条输入：

- [ ] `help` → 命令列表
- [ ] `ls --color` → 蓝色目录、绿色可执行文件、黄色文件（ANSI 颜色正确）
- [ ] `size` → `pty = <当前列>×<当前行>`
- [ ] `htop` → 全屏假面板（`#`/`-` 进度条 + 百分比），按 `q` 返回
- [ ] `clear` → 清屏
- [ ] `exit` → 会话结束，显示 `── 远端会话已结束（exit 0）──`

## 4. 窗口缩放

- [ ] 拖动窗口边缘改变大小，终端自动重排
- [ ] 终端出现 `[pty resized to W×H]`，数字与状态栏 `PTY` 一致
- [ ] 在 `htop` 里缩放窗口，面板边框会按新尺寸重绘

## 5. 主机密钥篡改（安全）

```powershell
# 1. 先正常连接一次，生成 data/known_hosts.json
# 2. 手动改掉里面的指纹
notepad <安装目录>\data\known_hosts.json
# 3. 重新启动应用
```

- [ ] 终端输出「主机密钥不匹配！… 已记录 … 本次 …」
- [ ] 状态栏显示红色错误状态
- [ ] 日志出现 `verdict=Mismatch accept=false`
- [ ] 连接确实被拒绝（不会进入 shell）

恢复：删除 `known_hosts.json` 中该条目后重连。

## 6. 真实 Linux 服务器（可选，需你自备）

内置测试服务器**不是真实 Linux**，`vim` / `tmux` / `htop` 只是模拟面板。若你有可用的 SSH 服务器：

```powershell
$env:LEONSSH_SSH_HOST="your-host"
$env:LEONSSH_SSH_PORT="22"
$env:LEONSSH_SSH_USER="root"
$env:LEONSSH_SSH_PASSWORD="..."
pnpm tauri dev
```

再验证 `ls --color`、`vim file.txt`、`tmux`、`htop` 与真实 resize 行为。

## 已知限制（阶段 2 范围内属正常）

- 连接配置写死为 `127.0.0.1:2222`（可用环境变量覆盖），没有连接表单 —— 阶段 3 提供
- 密码通过环境变量传入，尚未进 keyring —— 阶段 3
- 断开后不会自动重连；重新打开应用即可
- 中文输入法候选框在终端内可用，但自动化按键测试会被 IME 干扰，人工验收请直接用键盘
