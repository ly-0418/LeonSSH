# 文件管理器 · 阶段 B 验收

> 目标：右侧面板接入 SFTP 子系统，能浏览远程目录（名称/大小/时间/权限），支持进入、返回、刷新；排序在 Rust 侧完成。

## 0. 已由开发侧验证

截图 `docs/file-manager-phase-b.png`（同一窗口内）：

| 项目 | 结果 |
| --- | --- |
| 复用同一 SSH 连接 | 右侧 `/home/test` 由终端的 `Arc<Handle>` 打开 sftp 子系统，没有第二条 TCP/SSH 连接 |
| 远程列表 | `.config`（目录，700）、`.bash_history`（226 B，600）、`.viminfo`（755 B，600） |
| 权限列 | 独立列显示八进制权限 |
| 排序 | 目录优先，随后按名称（Rust `sftp::list`） |
| 路径栏 | 显示 `/home/test`，可输入 `/etc`、`/var/log` 跳转，`↑` 返回上级，`⟳` 刷新 |
| 绑定提示 | 头部显示「已绑定：Docker Alpine」，页脚显示会话名 |
| 无会话时 | 显示「还没有可用的 SSH 会话」占位 |
| 自动化 | 49 通过 / 4 ignored、0 告警、`tsc` 通过、release + NSIS 成功 |

## 1. 本阶段改动

| 层 | 文件 | 内容 |
| --- | --- | --- |
| Rust | `sftp/path.rs` | 列表/CRUD 全部改用 `normalize_remote`；对服务端返回的条目名做 `join_remote` 校验，非法名直接跳过 |
| Rust | `sftp/mod.rs` | 新增 `stat()`；`list()` 使用路径守卫；**删除** `local_home`/`local_list`（本地访问统一走 fs 插件） |
| Rust | `commands/sftp.rs` | 新增 `sftp_stat` 命令；删除两个本地命令 |
| 前端 | `components/file-manager/RemotePane.tsx` | 打开/关闭 SFTP、远程列表适配器、权限列、错误与加载态 |
| 前端 | `App.tsx` / `lib.rs` | `?connect=<id>` 深链 + `LEONSSH_AUTO_SESSION`，便于脚本化冒烟 |
| 前端 | `TerminalSession.ts` | 隐藏状态下状态栏不再显示 9×4 的假尺寸 |

## 2. 为什么删掉旧的本地命令

增量需求明确「本地路径必须走 Tauri fs 插件，不要绕过插件用 Rust `std::fs` 操作前端指定的任意路径」。
旧的 `local_list` / `local_home` 正是这种绕过，因此连同其测试一起删除；本地能力由 `lib/fs/localFs.ts` 独占。

## 3. 冒烟方式（可复现）

```powershell
docker start leonssh-sshd
$env:LEONSSH_START_VIEW = "files"
$env:LEONSSH_AUTO_SESSION = "2"     # sessions 表里的会话 id
$env:LEONSSH_START_LOCAL = "C:\Windows\System32\drivers\etc"
.\src-tauri\target\release\leonssh.exe
```

## 4. 已知限制

- 远程面板目前只读：新建/重命名/删除/上传/下载在阶段 C
- 符号链接按服务端 `lstat` 结果展示，暂不解析目标
- 超大目录一次返回全部条目（后续可加分页）
