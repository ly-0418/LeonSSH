# 文件管理器 · 阶段 D 验收

> 目标：双击远程文本文件 → 流式下载到应用临时目录 → CodeMirror 6 编辑（语法高亮）→ 保存时流式覆盖远程文件；支持另存为；关闭清理临时文件。

## 0. 已验证

| 验收项 | 结果 | 证据 |
| --- | --- | --- |
| 编辑器 | CodeMirror 6 + one-dark，行号/历史/括号匹配/自动缩进 | `docs/file-manager-phase-d.png` |
| 语法高亮 | 按文件名用 `@codemirror/language-data` 动态加载语言包，`.sh` 高亮正确（注释/字符串/关键字着色） | 同上 |
| 远程标识 | 工具栏徽标「远程文件」+ 完整远程路径，避免误认为是本地编辑 | 同上 |
| 临时目录 | `<安装目录>/data/edit/<editId>/<文件名>`，页脚显示实际路径 | 同上 |
| 打开流程 | SFTP 流式下载（非全量读入）→ 临时文件 | `editor::tests::real_ssh_editor_roundtrip` |
| 保存 | 前端 `writeTextFile(temp)` → `editor_save` → 流式**覆盖**上传 → 回读元数据校验 | 同上（断言远端字节等于新内容） |
| 另存为 | `editor_save_as` 写新路径并重定向会话 | 同上 |
| 一致性校验 | 保存后大小不一致 / mtime 倒退 → 警告条 | `editor/mod.rs::save` |
| 关闭清理 | `editor_close` 删除临时目录；终端关闭/应用退出统一清理 | 同上（断言临时文件已删除） |
| 权限错误提示 | 远端文件属主为 root 时保存报 `Permission denied` 并显示在编辑器内 | 实机截图（修复属主后保存成功） |

## 1. 实现要点

- **不做 SFTP 随机写编辑器**：整文件下载 → 本地编辑 → 整文件覆盖上传，闭环简单且不会把远端写成半截。
- **覆盖而非续传**：编辑器保存调用 `upload_overwrite`（强制从 0 且 `TRUNCATE`），否则文本变短时旧尾部会残留。
- **临时目录受管**：`EditorManager` 记录 editId → 临时路径；`cleanup_terminal`（终端关闭）与 `cleanup_all`（应用退出）都会删除。
- **大小上限 8 MiB**：超过直接拒绝并提示下载，避免把巨型日志灌进编辑器。
- **语言检测**：`LanguageDescription.matchFilename(languages, fileName)`，`.sh/.py/.json/.conf/Dockerfile/nginx.conf` 等均可命中；未命中时退化为纯文本。

## 2. 前端行为

| 操作 | 行为 |
| --- | --- |
| 双击远程文本文件 | 打开编辑器（`.sh .py .json .yaml .conf .md .txt .env Dockerfile` 等） |
| 双击远程二进制文件 | 走下载流程到本地当前目录 |
| 保存 | 写临时文件 → 流式上传 → 刷新远程列表；失败/不一致显示横幅 |
| 另存为 | 弹出远程路径输入框，成功后会话指向新路径 |
| 关闭 | 有未保存修改时确认；确认后删除临时文件 |

## 3. 已知限制

- 不支持多文件同时编辑（同一时间一个编辑会话面板）
- 覆盖上传期间远端文件短暂处于「写入中」状态（未实现原子替换 rename）
- 语法高亮依赖 `language-data` 的语言包，首次打开某语言会异步加载（数百毫秒）
