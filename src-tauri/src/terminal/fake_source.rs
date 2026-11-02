//! Phase-1 fake byte source.
//!
//! It exists to prove the pipe end-to-end without any SSH involved:
//!
//! ```text
//! producer task ──Bytes──▶ bounded mpsc(256) ──▶ pump ──▶ Channel<Raw> ──▶ xterm.js
//! ```
//!
//! In phase 2 this module is swapped for the russh read loop; `pump`, `sink`
//! and `registry` are intentionally transport-agnostic and stay untouched.
//!
//! The frames deliberately exercise the hard parts of a terminal: 24-bit and
//! 256-colour SGR, absolute cursor addressing, erase-line, scroll regions and
//! a live status block that is repainted in place every 120 ms.

use std::fmt::Write as _;
use std::time::{Duration, Instant};

use bytes::Bytes;
use tokio::sync::{mpsc, watch};

use super::input::echo_text;

const TICK: Duration = Duration::from_millis(120);
const HEARTBEAT_EVERY_TICKS: u64 = 8;
const SPINNER: [&str; 10] = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const HEARTBEAT_COLORS: [u8; 6] = [114, 147, 180, 213, 84, 117];

pub struct FakeSourceConfig {
    pub session_id: String,
    pub data_dir: String,
    pub cols: u16,
    pub rows: u16,
}

/// Runs until the close signal fires (or the output queue disappears).
pub async fn run(
    config: FakeSourceConfig,
    mut input_rx: mpsc::Receiver<Vec<u8>>,
    mut resize_rx: watch::Receiver<(u16, u16)>,
    mut close_rx: watch::Receiver<bool>,
    out_tx: mpsc::Sender<Bytes>,
) {
    let mut view = View::new(config);
    if push(&out_tx, view.render_full()).await.is_err() {
        return;
    }

    let mut ticker = tokio::time::interval(TICK);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    ticker.tick().await; // consume the immediate first tick

    loop {
        tokio::select! {
            biased;
            _ = close_rx.changed() => break,
            changed = resize_rx.changed() => {
                if changed.is_err() {
                    break;
                }
                let (cols, rows) = *resize_rx.borrow_and_update();
                view.resize(cols, rows);
                // Render first, then await: the mutable borrow of `view` must
                // end before the `select!` handler suspends.
                let frame = view.render_full();
                if push(&out_tx, frame).await.is_err() {
                    break;
                }
            }
            incoming = input_rx.recv() => {
                match incoming {
                    Some(bytes) => {
                        view.on_input(&bytes);
                        let frame = view.render_input_line();
                        if push(&out_tx, frame).await.is_err() {
                            break;
                        }
                    }
                    None => break,
                }
            }
            _ = ticker.tick() => {
                view.advance();
                let heartbeat = view.tick_count % HEARTBEAT_EVERY_TICKS == 0;
                let frame = view.render_tick(heartbeat);
                if push(&out_tx, frame).await.is_err() {
                    break;
                }
            }
        }
    }

    tracing::debug!(session = %view.session_id, "fake source stopped");
}

async fn push(tx: &mpsc::Sender<Bytes>, frame: String) -> Result<(), ()> {
    if frame.is_empty() {
        return Ok(());
    }
    tx.send(Bytes::from(frame.into_bytes())).await.map_err(|_| ())
}

struct View {
    session_id: String,
    data_dir: String,
    cols: u16,
    rows: u16,
    started: Instant,
    tick_count: u64,
    input_bytes: usize,
    input_echo: String,
    emitted_bytes: u64,
}

impl View {
    fn new(config: FakeSourceConfig) -> Self {
        Self {
            session_id: config.session_id,
            data_dir: config.data_dir,
            cols: config.cols.max(20),
            rows: config.rows.max(5),
            started: Instant::now(),
            tick_count: 0,
            input_bytes: 0,
            input_echo: String::new(),
            emitted_bytes: 0,
        }
    }

    fn resize(&mut self, cols: u16, rows: u16) {
        self.cols = cols.max(20);
        self.rows = rows.max(5);
    }

    fn advance(&mut self) {
        self.tick_count = self.tick_count.wrapping_add(1);
    }

    fn on_input(&mut self, bytes: &[u8]) {
        self.input_bytes += bytes.len();
        self.input_echo.push_str(&echo_text(bytes));
        let limit = (self.cols as usize).saturating_sub(6).max(16) * 2;
        if self.input_echo.chars().count() > limit {
            self.input_echo = tail(&self.input_echo, limit);
        }
    }

    // ---------------------------------------------------------------- frames

    fn render_full(&mut self) -> String {
        let layout = Layout::for_rows(self.rows);
        let mut out = String::with_capacity(4096);
        // Reset attributes + scroll region, clear screen, home the cursor.
        out.push_str("\x1b[0m\x1b[r\x1b[2J\x1b[H");

        self.banner(&mut out);
        self.info(&mut out);

        if !layout.compact {
            self.palette(&mut out);
            self.hints(&mut out);
            self.scroll_header(&layout, &mut out);
            let _ = write!(out, "\x1b[{};{}r", layout.scroll_top, layout.scroll_bottom);
            self.input_line(&mut out, layout.input_row);
        }

        self.status(&mut out, &layout);
        let park = if layout.input_row > 0 {
            layout.input_row
        } else {
            layout.status_top
        };
        let _ = write!(out, "\x1b[{};1H", park);
        self.emitted_bytes = self.emitted_bytes.saturating_add(out.len() as u64);
        out
    }

    fn render_tick(&mut self, heartbeat: bool) -> String {
        let layout = Layout::for_rows(self.rows);
        let mut out = String::with_capacity(1024);

        if heartbeat && !layout.compact && layout.scroll_bottom > layout.scroll_top {
            // Feed one line into the scroll region: this is what makes the
            // renderer scroll, and it validates DECSTBM handling.
            let _ = write!(out, "\x1b[{};1H\r\n", layout.scroll_bottom);
            let color = HEARTBEAT_COLORS
                [(self.tick_count as usize / HEARTBEAT_EVERY_TICKS as usize) % HEARTBEAT_COLORS.len()];
            let _ = write!(
                out,
                "\x1b[38;5;{color}m[{:>7.2}s] heartbeat seq={:<4} payload={:>6} B latency={:>3} ms\x1b[0m",
                self.started.elapsed().as_secs_f64(),
                self.tick_count / HEARTBEAT_EVERY_TICKS,
                512 + (self.tick_count % 97) * 13,
                8 + (self.tick_count % 41),
            );
        }

        self.status(&mut out, &layout);
        let park = if layout.input_row > 0 {
            layout.input_row
        } else {
            layout.status_top
        };
        let _ = write!(out, "\x1b[{};1H", park);
        self.emitted_bytes = self.emitted_bytes.saturating_add(out.len() as u64);
        out
    }

    fn render_input_line(&mut self) -> String {
        let layout = Layout::for_rows(self.rows);
        let mut out = String::with_capacity(256);
        if layout.input_row > 0 {
            self.input_line(&mut out, layout.input_row);
            let _ = write!(out, "\x1b[{};1H", layout.input_row);
        }
        self.emitted_bytes = self.emitted_bytes.saturating_add(out.len() as u64);
        out
    }

    // ---------------------------------------------------------------- pieces

    fn banner(&self, out: &mut String) {
        let _ = write!(
            out,
            "\x1b[1;38;2;74;222;128m▌\x1b[0m \x1b[1;38;2;226;232;240mLeonSSH\x1b[0m \
             \x1b[38;5;240m·\x1b[0m \x1b[38;2;56;189;248m阶段 1 · 字节流通路骨架\x1b[0m \
             \x1b[38;5;240mv{}\x1b[0m\r\n",
            env!("CARGO_PKG_VERSION")
        );
        let _ = write!(
            out,
            "\x1b[38;5;245mTauri 2 · React 19 · xterm.js 6 · 输出 = Channel(ArrayBuffer) · 输入 = 独立 command · resize = 独立 command\x1b[0m\r\n"
        );
    }

    fn info(&self, out: &mut String) {
        let _ = write!(
            out,
            "\x1b[38;5;110msession\x1b[0m {}  \x1b[38;5;110mpty\x1b[0m {}×{}  \
             \x1b[38;5;110mtransport\x1b[0m tauri-channel\r\n",
            self.session_id, self.cols, self.rows
        );
        let dir = tail(&self.data_dir, self.cols.saturating_sub(8) as usize);
        let _ = write!(out, "\x1b[38;5;110mdata\x1b[0m    \x1b[38;5;245m{dir}\x1b[0m\r\n");
    }

    fn palette(&self, out: &mut String) {
        out.push_str("\x1b[38;5;245m16 色前景 \x1b[0m");
        for i in 0..16u8 {
            let _ = write!(out, "\x1b[38;5;{i}m█");
        }
        out.push_str("\x1b[0m\r\n");

        out.push_str("\x1b[38;5;245m16 色背景 \x1b[0m");
        for i in 0..16u8 {
            let _ = write!(out, "\x1b[48;5;{i}m ");
        }
        out.push_str("\x1b[0m\r\n");

        out.push_str("\x1b[38;5;245m256 色   \x1b[0m");
        let mut n = 16u16;
        while n < 232 {
            let _ = write!(out, "\x1b[38;5;{n}m█");
            n += 3;
        }
        out.push_str("\x1b[0m\r\n");
    }

    fn hints(&self, out: &mut String) {
        out.push_str(
            "\x1b[38;5;245m键盘输入 → invoke(\"ssh_write\") → Rust 日志   ·   \
             resize → invoke(\"ssh_resize\")   ·   关闭窗口 = 协作式退出\x1b[0m\r\n",
        );
        out.push_str("\r\n");
    }

    fn input_line(&self, out: &mut String, row: u16) {
        let _ = write!(out, "\x1b[{};1H\x1b[2K\x1b[38;5;114m❯ \x1b[0m\x1b[38;5;252m", row);
        let max = self.cols.saturating_sub(6) as usize;
        out.push_str(&tail(&self.input_echo, max));
        out.push_str("\x1b[0m\x1b[7m \x1b[0m");
    }

    fn scroll_header(&self, layout: &Layout, out: &mut String) {
        let _ = write!(
            out,
            "\x1b[{};1H\x1b[2K\x1b[38;5;240m── 滚动区 · 模拟远端 tail -f，用于验证滚动与重绘 ──\x1b[0m",
            layout.scroll_top - 1
        );
    }

    fn status(&self, out: &mut String, layout: &Layout) {
        let elapsed = self.started.elapsed().as_secs_f64();
        let spinner = SPINNER[(self.tick_count as usize) % SPINNER.len()];
        let progress = (self.tick_count % 48) as usize;
        let filled = progress / 2;
        let bar: String = (0..24)
            .map(|i| if i < filled { '█' } else { '░' })
            .collect();
        let percent = progress * 100 / 48;

        let line1 = format!(
            "\x1b[38;5;110m▌\x1b[0m {spinner} session {} · pty {}×{} · uptime {elapsed:.1}s · frames {}",
            self.session_id, self.cols, self.rows, self.tick_count
        );
        let line2 = format!(
            "\x1b[38;5;114m[{bar}]\x1b[0m {percent:>3}%   input {} B   emitted {} KiB",
            self.input_bytes,
            self.emitted_bytes / 1024
        );
        let line3 = "\x1b[38;5;240m阶段 1 无远端：输入只回显并写日志 · 真实 shell 在阶段 2 接入\x1b[0m";

        let rows = [line1, line2.to_string(), line3.to_string()];
        for (offset, line) in rows.iter().enumerate() {
            let row = layout.status_top + offset as u16;
            if row > self.rows {
                break;
            }
            let _ = write!(out, "\x1b[{};1H\x1b[2K{}\x1b[0m", row, line);
        }
    }
}

struct Layout {
    compact: bool,
    scroll_top: u16,
    scroll_bottom: u16,
    input_row: u16,
    status_top: u16,
}

impl Layout {
    fn for_rows(rows: u16) -> Self {
        if rows >= 20 {
            Self {
                compact: false,
                scroll_top: 14,
                scroll_bottom: rows - 4,
                input_row: 12,
                status_top: rows - 2,
            }
        } else {
            Self {
                compact: true,
                scroll_top: 0,
                scroll_bottom: 0,
                input_row: 0,
                status_top: rows.saturating_sub(1),
            }
        }
    }
}

/// Keeps the last `max_chars` characters (inputs scroll from the right).
fn tail(text: &str, max_chars: usize) -> String {
    let count = text.chars().count();
    if count <= max_chars {
        return text.to_string();
    }
    text.chars().skip(count - max_chars).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn view(cols: u16, rows: u16) -> View {
        View::new(FakeSourceConfig {
            session_id: "s1".into(),
            data_dir: "D:\\LeonSSH\\data".into(),
            cols,
            rows,
        })
    }

    #[test]
    fn full_frame_contains_ansi_primitives() {
        let mut v = view(120, 40);
        let frame = v.render_full();
        assert!(frame.contains("\x1b[2J"), "clear screen");
        assert!(frame.contains("\x1b[H"), "cursor home");
        assert!(frame.contains("38;2;"), "24-bit colour");
        assert!(frame.contains("38;5;"), "256-colour");
        assert!(frame.contains("\x1b[14;36r"), "scroll region 14..36");
        assert!(frame.contains("\x1b[12;1H"), "input line row");
    }

    #[test]
    fn resize_changes_the_rendered_geometry() {
        let mut v = view(120, 40);
        v.resize(90, 30);
        let frame = v.render_full();
        assert!(frame.contains("pty 90×30"), "{}", frame);
        assert!(frame.contains("\x1b[14;26r"));
    }

    #[test]
    fn compact_layout_is_used_on_short_terminals() {
        let layout = Layout::for_rows(12);
        assert!(layout.compact);
        assert_eq!(layout.status_top, 11);
        let mut v = view(80, 12);
        let frame = v.render_full();
        assert!(!frame.contains("16 色前景"));
    }

    #[test]
    fn input_echo_is_bounded() {
        let mut v = view(40, 24);
        for _ in 0..100 {
            v.on_input(b"abcdefgh");
        }
        assert!(v.input_echo.chars().count() <= (40 - 6) * 2);
        assert_eq!(v.input_bytes, 800);
    }

    #[test]
    fn heartbeat_redraws_the_scroll_region() {
        let mut v = view(120, 40);
        v.advance();
        let frame = v.render_tick(true);
        assert!(frame.starts_with("\x1b[36;1H\r\n"), "{}", frame);
        assert!(frame.contains("heartbeat"));
    }

    #[test]
    fn tail_keeps_the_newest_characters() {
        assert_eq!(tail("abcdef", 3), "def");
        assert_eq!(tail("abc", 10), "abc");
        assert_eq!(tail("你好世界", 2), "世界");
    }
}
