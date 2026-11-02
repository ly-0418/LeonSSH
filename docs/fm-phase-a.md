# 文件管理器 · 阶段 A 验收

> 目标：新增双栏文件管理视图，左侧本地面板可完整浏览，右侧远程面板搭好结构、留待阶段 B 接入。

## 0. 已由开发侧验证

| 项目 | 结果 | 证据 |
| --- | --- | --- |
| 新增视图 | 侧边栏「终端 / 文件管理」切换，终端保持挂载（切回不丢滚动缓冲） | `docs/file-manager-phase-a.png` |
| 本地浏览 | 默认用户主目录，`C:\Users\10704` 列出 85 项 | 同上（早前截图） |
| 路径栏跳转 | 输入 `C:\Windows\System32\drivers\etc` 直接列出 6 个文件 | 同上 |
| 目录/文件区分 | 目录 📁 + 高亮名称并排在前面；文件显示大小与修改时间（`934 B`、`17.2 KiB`…） | 同上 |
| 返回上级 | `↑` 按钮 + 盘符下拉（`C:\`、`D:\`） | `local_roots` 日志 `roots=["C:\\", "D:\\"]` |
| 右侧占位 | 结构完整（路径栏/表格/页脚），无会话时提示先连接 | 同上 |
| 路径安全 | `sftp/path.rs` 规范化与 `../` 拦截，6 个单测 | `cargo test sftp::path` |
| 自动化 | 49 通过 / 4 ignored、`cargo check` 0 告警、`tsc` 通过、release + NSIS 成功 | 构建日志 |

## 1. 文件清单

| 层 | 文件 | 职责 |
| --- | --- | --- |
| Rust | `commands/local.rs` | 仅 `local_roots()`：枚举盘符 |
| Rust | `sftp/path.rs` | 远程路径规范化 / 名称校验 / 包含关系判定（阶段 B/C 使用） |
| Rust | `lib.rs` | 注册 fs 插件；启动时把用户目录与全部盘符加入 fs 运行时 scope；`LEONSSH_START_VIEW` 深链 |
| 配置 | `capabilities/default.json` | `fs:read-all` + `fs:write-all`（路径由运行时 scope 决定） |
| 前端 | `lib/fs/types.ts` | 左右栏共用的 `FileEntry` |
| 前端 | `lib/fs/paths.ts` | Windows 盘符根、join/parent、面包屑 |
| 前端 | `lib/fs/localFs.ts` | **本地 FS 唯一入口**：plugin-fs 的 readDir/stat + 有界并发补充元数据 |
| 前端 | `components/file-manager/*` | FileManager / LocalPane / RemotePane / PathBar / FileTable / useFilePane / format |
| 前端 | `styles/file-manager.css` | 双栏布局、表格、路径栏 |

## 2. 关键实现说明

- **本地路径全部走 `@tauri-apps/plugin-fs`**，没有新增任何用 `std::fs` 读前端路径的命令；Rust 只提供盘符列表。
- fs 插件默认只允许应用目录，因此在 `setup()` 里用 `FsExt::fs_scope().allow_directory(..., true)` 把用户目录与每个盘符加入运行时 scope。
- `readDir` 不返回大小/时间，本地面板先渲染列表，再用 8 并发 `stat` 逐项回填，大目录不会卡住 UI。
- 两栏状态完全隔离（各自 `useFilePane` 实例），切到文件视图时终端仅 `display:none`，SSH 会话不被销毁。

## 3. 开发/验证用深链

```powershell
$env:LEONSSH_START_VIEW = "files"          # 启动即进入文件管理
$env:LEONSSH_START_LOCAL = "C:\Windows"    # 左侧面板初始目录
pnpm tauri dev
```

## 4. 已知限制（阶段 A 范围内）

- 右侧面板是占位；远程列表在阶段 B 接入
- 本地面板暂不支持新建/重命名/删除（阶段 C 与传输一起做）
- 拖拽、多选批量操作在阶段 C
- `Ctrl/Shift` 多选已实现但尚无批量动作
