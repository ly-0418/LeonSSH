# 文件管理器 · 阶段 C 验收

> 目标：上传/下载流式分块（256 KiB）、进度推送、断点续传、任务队列（进度/速度/取消）、拖拽上传、双击下载。

## 0. 已验证

| 验收项 | 结果 | 证据 |
| --- | --- | --- |
| 流式分块 | 固定 256 KiB 缓冲，内存与文件大小无关 | `transfer/stream.rs` |
| 600 MB 不 OOM | 600 MB 上传 3.94 s，远程大小 629 145 600 B | `cargo test -- --ignored real_ssh_upload_600mb_is_streamed` |
| 断点续传（上传） | 1 MiB 处取消 → 再次上传 `resumed_from == 远程已有大小` | `real_ssh_transfers_resume_after_cancel` |
| 断点续传（下载） | 同理，续传后本地文件与源文件**逐字节一致** | 同上 |
| 目标已完整 | 目标大小 == 源大小 → 状态 `skipped`，不重复传输 | `transfer/stream.rs::plan` |
| 目标更大 | 回退为从头传输（`Fresh`），不破坏已有数据 | 同上（单测） |
| 进度推送 | 每 ≤120 ms 或每块推一次 `TransferTask` | 截图队列 `934 B / 934 B` |
| 取消 | 每块之间检查 `AtomicBool`，取消后任务状态 `cancelled` | 单测 + 集成测试 |
| 队列 UI | 方向、文件名、进度条、字节数、速度、状态、取消按钮 | `docs/file-manager-phase-c.png` |
| 上传 | 选中本地 `hosts` → 队列完成 → 远程面板自动刷新出现 `hosts 934 B 644` | 同上 |
| 下载 | 双击远程 `.viminfo` → 队列完成 → 本地出现 755 B 文件 | `docs/file-manager-phase-c-download.png` |
| 拖拽（同窗口） | 本地行 `draggable`，远程面板接收 `application/x-leonssh-path` 并上传 | 代码路径；未做自动点击验证 |
| 拖拽（系统） | `getCurrentWebview().onDragDropEvent` 拿到绝对路径 → 上传，面板高亮 | 代码路径；未做自动拖拽验证 |

## 1. 实现要点

- **一套代码两种方向**：`stream::plan(src_size, dst_size)` 决定 `Fresh / Resume(offset) / AlreadyComplete`；
  `stream::copy_stream` 是唯一的拷贝循环，上传下载只是 seek 的位置不同。
- **续传安全性**：续传时打开远端文件**不**带 `TRUNCATE`；从头传输才截断。目标比源大时判定为「前提不成立」，回退从头。
- **取消粒度**：按块检查，最多多传 256 KiB；已传字节保留在目标端，下次即可续传。
- **进度节流**：闭包内 `Instant` 判重，避免每块都走一次 IPC。
- **队列在 Rust**：任务表在 `TransferManager`，前端只是订阅者；面板关掉再打开会重放快照（`transfer_attach`）。
- **本地路径校验**：绝对路径、无 `..`、源必须是文件、目标父目录必须存在。

## 2. 手动验收（拖拽）

1. 选中本地文件，拖到右侧远程面板 → 松开后队列出现上传任务，面板虚线高亮。
2. 从资源管理器拖一个文件到远程面板 → 同上。
3. 传输中点「取消」→ 状态变「已取消」，再次点「上传」→ 状态显示「续传自 X」并从中断处继续。

## 3. 已知限制

- 目录递归上传/下载未实现（拖入目录会提示「不是普通文件」）
- 队列不持久化（应用重启后清空）
- 速度是前端按 400 ms 采样的瞬时值，不是滑动平均
