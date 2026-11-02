# 阶段 4 验收清单

> 目标：在与终端**同一条 SSH 连接**上打开 SFTP 子系统，提供本地/远程双面板与上传下载。

## 0. 已由开发侧验证

| 项目 | 结果 | 证据 |
| --- | --- | --- |
| 复用同一连接 | SFTP 通过 `Handle::channel_open_session` + `request_subsystem("sftp")` 打开，不新建 TCP/SSH 连接 | `sftp::open_subsystem` |
| 目录浏览 | `sftp_list` 返回名称/路径/类型/大小/权限/修改时间，目录优先排序 | `cargo test sftp::tests::real_ssh_sftp_roundtrip` |
| 上传 | 70 KB 文件分块（32 KiB）上传，服务端文件大小一致 | 同上 |
| 下载 | 下载后逐字节比对与原文件一致 | 同上 |
| 权限修改 | `chmod 600` 后经 `metadata` 读回 `0o600` | 同上 |
| 重命名 / 删除 | 重命名后可见新名；删除文件与目录后 `/tmp` 无残留 | 同上 |
| 本地面板 | `local_list` 目录优先、大小正确 | `cargo test sftp::tests::local_listing_reports_directories_first` |
| 上传下载进度 | 分块循环 + 每 256 KiB 通过 `Channel<TransferProgress>` 推送，前端进度条 | `commands/sftp.rs`、`SftpPanel.tsx` |

运行方式（真实 sshd 容器）：

```powershell
docker start leonssh-sshd
cargo test --manifest-path src-tauri/Cargo.toml -- --ignored real_ssh_sftp_roundtrip
```

## 1. 手动验收步骤

1. 应用里连接一个会话（终端出现 `$` 提示符）。
2. 点标签栏右侧的 **文件** 按钮 → 打开 SFTP 面板。
3. 左侧是本地目录（默认用户主目录），右侧是远端目录（默认登录后的 home）。

- [ ] 左右两侧都能双击进入子目录，点 `↑` 返回上级
- [ ] 选中左侧一个文件 → 点「↑ 上传」→ 右侧列表出现该文件，底部出现进度
- [ ] 选中右侧文件 → 点「↓ 下载」→ 左侧出现该文件
- [ ] 选中右侧文件 → 「权限」输入 `600` → 再选中它时元数据显示 `600`
- [ ] 「新建目录」「重命名」「删除」均生效
- [ ] 关闭面板后再打开，功能正常（旧子系统被关闭，不泄漏通道）

## 2. 实现要点

- **不重连**：`AppState` 为每个终端保存 `Arc<russh::client::Handle>`，SFTP 命令按 `terminalId` 取用同一个连接。
- **有界传输**：固定 32 KiB 缓冲区，内存占用与文件大小无关；进度按 256 KiB 节流推送，避免刷爆 IPC。
- **权限位**：`FileAttributes { permissions }` 走 SFTP `SETSTAT`，不做本地 chmod 映射。
- **错误隔离**：SFTP 失败只影响面板，不打断终端会话。

## 3. 已知限制

- 只支持单文件上传/下载，暂不支持拖拽与目录递归传输
- 权限用八进制文本输入，未做可视化权限矩阵
- 本地侧不提供删除/重命名（只做浏览与传输），避免误删本地文件
