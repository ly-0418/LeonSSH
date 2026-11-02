# 阶段 3 验收清单

> 目标：会话持久化（SQLite）、密码进 Windows 凭据管理器、多标签、连接表单、known_hosts 迁移到 SQLite。

## 0. 已由开发侧验证

| 项目 | 结果 | 证据 |
| --- | --- | --- |
| SQLite 建库建表 | `<安装目录>\data\leonssh.db`，`sessions` + `known_hosts` | 运行日志 `sqlite ready path=...\leonssh.db` |
| 会话 CRUD | 创建/列表/更新/删除 + 空名校验 + keyring 引用 | `cargo test storage::sessions`（4 个测试） |
| known_hosts 落 SQLite | 首次记录、重载后仍匹配、forget 后回到 FirstUse、重复记录只留一条 | `cargo test ssh::hostkey`（4 个测试） |
| 凭据管理器 | 密码写入/读回/删除全部走 Windows Credential Manager | `cargo test secure::tests::password_roundtrip_through_the_credential_manager` |
| 密码不落库 | `sessions.keyring_ref` 只存引用，SQLite 无任何密码字段 | 表结构 + `storage` 测试断言 `keyring_ref` |
| 多标签 UI | 侧边栏 + 标签栏 + 每标签独立 xterm（隐藏不销毁，保留回滚缓冲） | `docs/phase-3-sessions.png` |
| 连接表单 | 首启动内联表单，预填默认值，密码提示保存位置 | `docs/phase-3-onboarding.png` |
| 自动化测试 | 37 通过 / 2 ignored（docker 验收 + 种子脚本） | `cargo test` |

## 1. 手动验收步骤（需要你操作，约 2 分钟）

```powershell
# 1. 确保真实 sshd 容器在跑
docker start leonssh-sshd

# 2. 启动应用
pnpm tauri dev
```

首次启动会进入 `新建会话` 表单：

- [ ] 名称、主机 `127.0.0.1`、端口 `2222`、用户名 `test` 已预填
- [ ] 填密码 `test` → 点「创建并连接」→ 终端出现 Alpine 的 `Welcome to Alpine!` 与 `$` 提示符
- [ ] 状态栏显示 `已就绪 / WebGL2 / PTY W×H / terminal s1 / 127.0.0.1:2222`

多标签：

- [ ] 左侧「+ 新建」再建一个（同名也行）→ 第二个标签出现并连接
- [ ] 两个标签来回切换，**第一个标签的输出仍在**（不是重新连接）
- [ ] 关闭标签 → 后端会话被关闭（日志 `terminal closed ... outcome=Graceful`）

持久化：

- [ ] 关闭应用再打开 → 侧边栏会话仍在，标签不自动恢复（安全考虑）
- [ ] 点会话名即可连接，**不需要重新输入密码**（来自凭据管理器）

TOFU：

- [ ] 左侧「已知主机」→ 看到 `127.0.0.1:2222` 与 `SHA256:...` 指纹
- [ ] 点「忘记」→ 下次连接会重新记录（日志 `host key pinned`）

凭据管理器核对：

```powershell
cmdkey /list | findstr /i leonssh
```

- [ ] 能看到 `com.leonssh.app` 相关条目
- [ ] 用任意 SQLite 工具打开 `data\leonssh.db`，`sessions` 表里**没有**密码字段

## 2. 设计说明

- **数据库位置**：`tauri-plugin-sql` 默认把 `sqlite:` 映射到 `%APPDATA%`，与本项目「所有数据在安装目录」的要求冲突。
  因此由 Rust 在 `<安装目录>/data/leonssh.db` 建池、跑迁移，并把池注册进插件的 `DbInstances`
  （前端若用 `@tauri-apps/plugin-sql` 的 `Database.get("sqlite:leonssh.db")`，拿到的是同一个池）。
- **密码边界**：`session_set_password` 写凭据管理器并回写 `keyring_ref`；`ssh_open` 读取后只在内存里传给 russh。
  任何日志/错误信息都不包含密码（`AuthMethod` 的 `Debug` 是手写的脱敏实现）。
- **多标签**：每个标签一个 `TerminalSession`/xterm 实例，非活动标签仅 `display:none`，回滚缓冲保留；
  切换时重新 `fit()` 并按新尺寸发 `window_change`。

## 3. 已知限制

- 标签页不跨重启恢复（阶段 4/5 可加「恢复上次标签」）
- 仅支持密码认证；密钥认证的表字段（`auth_method`/`private_key_path`）已预留
- UI 交互（点击创建连接）尚未由我自动化验证：验收时桌面被系统安全提示遮挡，我只做了后端与静态界面验证
