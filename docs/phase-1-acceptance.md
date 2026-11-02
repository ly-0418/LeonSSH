# 阶段 1 验收清单

> 目标：证明「字节流不走 JSON」这条硬约束在真实运行中成立，并且输入/控制两条独立通道可用。

## 0. 已由开发侧实测通过（附证据）

| 项目 | 结果 | 证据 |
| --- | --- | --- |
| release 可执行文件 | 7.96 MB，可启动、正常渲染 | `docs/phase-1-screenshot.png` |
| NSIS 安装包 | 1.99 MB，静默安装/卸载均成功 | 安装到 `%LOCALAPPDATA%\LeonSSH` |
| 数据目录跟随安装目录 | 安装目录下生成 `data/{cache,logs,webview}` | 日志 `data_dir=...\LeonSSH\data` |
| 不污染 `%APPDATA%` | `com.leonssh.app` 目录不存在 | 安装运行后检查 |
| 渲染器 | 状态栏显示 `WebGL2`（本机 GPU 可用） | 截图右下角 |
| 键盘输入 | `terminal input session=s1 bytes=11 preview=hello-stage` | `data/logs/leonssh.log.*` |
| resize 控制通道 | 窗口改尺寸后 `terminal resize session=s1 cols=90 rows=21` | 同上 |
| 协作式关闭 | `session closed during shutdown session=s1 outcome=Graceful` | 同上 |
| 单元测试 | 24/24 通过（注册表、关闭超时、聚合、假数据帧、路径、错误序列化） | `cargo test` |
| 编译告警 | `cargo check` 0 warning，`tsc --noEmit` 通过 | 构建日志 |

### 截图说明

- `docs/phase-1-screenshot.png`：1180×800 窗口，可见彩色 banner、16 色 / 256 色色板、滚动区 heartbeat、状态块（spinner + 进度条 + uptime + frames）、底部状态栏（`已就绪 / WebGL2 / PTY / session / 活跃会话 / 数据目录`）。
- `docs/phase-1-input-resize.png`：输入 `hello-stage` 后的回显行 `❯ hello-stage↵`，以及窗口缩小到 90×21 后 `pty` 同步变小。

> 注：自动化按键测试（SendKeys）会受系统中文输入法影响（数字键被候选框吃掉、标点被全角化），这与应用无关；人工验收请在英文输入状态下敲击。

## 1. 前置

```powershell
pnpm install
pnpm tauri dev
```

首次编译需要几分钟（Tauri 依赖树较大）。

## 1. ANSI 渲染

- [ ] 窗口打开后终端出现两行彩色 banner（绿色竖条 + 青色标题）
- [ ] 出现 16 色前景条、16 色背景条、256 色渐变条
- [ ] 每秒左右在滚动区新增一行彩色 heartbeat，画面自然向上滚动
- [ ] 底部状态块每 120ms 原地重绘：spinner、进度条、uptime、frames 都在变
- [ ] 没有乱码方块，中文正常显示

## 2. 键盘输入

- [ ] 输入 `hello` 回车
- [ ] 终端第 12 行出现 `❯ hello↵` 回显，光标方块跟着移动
- [ ] 启动应用的终端（`pnpm tauri dev` 的控制台）出现日志：

```text
INFO leonssh_lib::commands::ssh: terminal input session=s1 bytes=6 preview="hello\r"
```

## 3. resize 控制通道

- [ ] 拖动窗口边缘改变大小，终端自动重排（不出现横向滚动条）
- [ ] 状态栏 `PTY` 数字变化
- [ ] 控制台出现 `terminal resize session=s1 cols=… rows=…`
- [ ] banner 里的 `pty W×H` 同步变化（说明 resize 真的到了后端会话）

## 4. 字节流类型（关键约束）

打开 DevTools（开发模式下 `F12` 或右键检查），在 `TerminalSession.ts` 的
`handleOutput` 打断点，观察参数：应为 `ArrayBuffer`，`byteLength` 随帧变化；
**不应**是 `Array<number>`。

也可在控制台执行：

```js
// 触发一次 WebGL 上下文丢失，验证渲染器回退
const canvas = document.querySelector(".xterm-screen canvas");
canvas.getContext("webgl2").getExtension("WEBGL_lose_context").loseContext();
```

- [ ] 状态栏渲染器从 `WebGL2` 变为 `DOM`
- [ ] 屏幕内容与滚动历史**没有**丢失
- [ ] 出现黄色提示条「WebGL 渲染不可用，已回退 DOM」

## 5. 数据目录

- [ ] 状态栏右侧显示 `数据目录 <安装目录>\data`
- [ ] 该目录下存在 `logs/`、`cache/`、`webview/`
- [ ] `logs/` 中有当天的 `leonssh.log.YYYY-MM-DD`
- [ ] `%APPDATA%`、`%LOCALAPPDATA%` 下没有新增 LeonSSH 数据目录（回退情况除外）

## 6. 安装包

- [ ] 运行 `LeonSSH_0.1.0_x64-setup.exe` 安装到 `%LOCALAPPDATA%\Programs\LeonSSH`
- [ ] 从开始菜单启动，功能与 dev 一致
- [ ] 安装目录下生成 `data/`，日志写入其中
- [ ] 卸载后安装目录被清理

## 已知边界（阶段 1 范围内属正常）

- 敲 Ctrl+C 不会中断任何东西（没有远端）
- 关闭窗口时若会话未响应会在 2s 后强制 abort，日志记录 `ForcedAbort`
