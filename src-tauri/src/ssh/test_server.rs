//! In-process SSH server used for phase-2 acceptance and integration tests.
//!
//! This is **not** a real Linux shell — it is a deterministic fake shell that
//! speaks real SSH and real ANSI, so the client can be verified end to end
//! (auth, PTY request, shell channel, byte streaming, window-change) without
//! Docker, WSL or administrator rights.
//!
//! Run it with:
//! ```text
//! cargo run --features test-server --bin ssh-test-server
//! ```

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use russh::keys::PrivateKey;
use russh::server::{self, Auth, Msg, Session};
use russh::{Channel, ChannelId};

/// Embedded ed25519 host key (test-only, obviously not a secret).
pub const HOST_KEY_PEM: &str = include_str!("test_host_key");

/// SHA256 fingerprint of [`HOST_KEY_PEM`], as printed by `ssh-keygen -lf`.
pub const HOST_KEY_FINGERPRINT: &str =
    "SHA256:fQYsPiKE822SlsV6vOY3b44b5eIsP8KDxxpIfbOPMBc";

pub const TEST_USER: &str = "test";
pub const TEST_PASSWORD: &str = "test";

const HELP: &str = "\
命令列表（假 shell）：
  help        显示本帮助
  ls --color  彩色文件列表
  size        打印当前 PTY 尺寸
  htop        假全屏程序（会随窗口 resize 重绘）
  vim         假编辑器（同上）
  tmux        假终端复用器（同上）
  clear       清屏
  exit        结束会话
按 q 可从全屏程序返回。
";

pub fn config() -> Arc<server::Config> {
    let key = PrivateKey::from_openssh(HOST_KEY_PEM.trim()).expect("embedded host key is valid");
    Arc::new(server::Config {
        inactivity_timeout: Some(Duration::from_secs(300)),
        auth_rejection_time: Duration::from_millis(10),
        auth_rejection_time_initial: Some(Duration::from_millis(0)),
        keys: vec![key],
        ..Default::default()
    })
}

pub struct TestServer {
    username: String,
    password: String,
}

impl Default for TestServer {
    fn default() -> Self {
        Self::new()
    }
}

impl TestServer {
    pub fn new() -> Self {
        Self {
            username: TEST_USER.to_string(),
            password: TEST_PASSWORD.to_string(),
        }
    }
}

impl server::Server for TestServer {
    type Handler = TestHandler;

    fn new_client(&mut self, peer: Option<SocketAddr>) -> TestHandler {
        tracing::info!(?peer, "client connected");
        TestHandler {
            username: self.username.clone(),
            password: self.password.clone(),
            dims: (80, 24),
            line: Vec::new(),
            escape_remaining: 0,
            mode: Mode::Shell,
            authenticated: false,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Mode {
    Shell,
    /// A fake full-screen program; any `q` returns to the shell.
    App(&'static str),
}

pub struct TestHandler {
    username: String,
    password: String,
    dims: (u32, u32),
    line: Vec<u8>,
    escape_remaining: u8,
    mode: Mode,
    authenticated: bool,
}

impl TestHandler {
    fn prompt(&self) -> String {
        "\x1b[38;5;114mtest@leonssh\x1b[0m:\x1b[38;5;39m~\x1b[0m$ ".to_string()
    }

    fn banner(&self) -> String {
        format!(
            "\x1b[2J\x1b[H\
             \x1b[1;38;2;74;222;128m▌ LeonSSH Test SSH Server\x1b[0m \
             \x1b[38;5;244mrussh 0.65 · {}×{}\x1b[0m\r\n\
             \x1b[38;5;245m阶段 2 内置测试服务器：验证认证 / PTY / 字节流 / resize，不是真实 Linux。\x1b[0m\r\n\
             \x1b[38;5;245m输入 help 查看命令；拖动窗口边缘会看到 `size` 与全屏框的变化。\x1b[0m\r\n\r\n",
            self.dims.0, self.dims.1
        )
    }

    fn write(
        &self,
        session: &mut Session,
        channel: ChannelId,
        text: &str,
    ) -> Result<(), russh::Error> {
        session.data(channel, text.to_string())
    }

    fn flush(
        &self,
        session: &mut Session,
        channel: ChannelId,
        out: &mut String,
    ) -> Result<(), russh::Error> {
        if out.is_empty() {
            return Ok(());
        }
        let text = std::mem::take(out);
        self.write(session, channel, &text)
    }

    fn execute(
        &mut self,
        session: &mut Session,
        channel: ChannelId,
    ) -> Result<bool, russh::Error> {
        // Case-insensitive on purpose: automated keyboard injection (SendKeys)
        // respects the host CapsLock state, so the fixture must not care.
        let line = String::from_utf8_lossy(&self.line).trim().to_ascii_lowercase();
        self.line.clear();
        self.write(session, channel, "\r\n")?;

        let keep = match line.as_str() {
            "" => true,
            "exit" | "logout" => {
                self.write(session, channel, "logout\r\n")?;
                false
            }
            "help" => {
                self.write(session, channel, HELP)?;
                true
            }
            "ls" | "ls --color" | "ls -la" => {
                let listing = "\x1b[38;5;39mdrwxr-xr-x\x1b[0m  2 test test  4096  \x1b[38;5;39m.\x1b[0m\r\n\
                               \x1b[38;5;39mdrwxr-xr-x\x1b[0m 18 root root  4096  \x1b[38;5;39m..\x1b[0m\r\n\
                               \x1b[38;5;114m-rw-r--r--\x1b[0m  1 test test  1234  \x1b[38;5;221mnotes.md\x1b[0m\r\n\
                               \x1b[1;38;5;114m-rwxr-xr-x\x1b[0m  1 test test 88912  \x1b[1;38;5;114mrun.sh\x1b[0m\r\n";
                self.write(session, channel, listing)?;
                true
            }
            "size" => {
                let text = format!("pty = {}×{}\r\n", self.dims.0, self.dims.1);
                self.write(session, channel, &text)?;
                true
            }
            "clear" => {
                self.write(session, channel, "\x1b[2J\x1b[H")?;
                true
            }
            other @ ("htop" | "top" | "vim" | "vi" | "tmux") => {
                let kind = match other {
                    "htop" | "top" => "htop",
                    "tmux" => "tmux",
                    _ => "vim",
                };
                self.mode = Mode::App(kind);
                let frame = self.render_app(kind);
                self.write(session, channel, &frame)?;
                true
            }
            unknown => {
                let text = format!("sh: command not found: {unknown}\r\n");
                self.write(session, channel, &text)?;
                true
            }
        };

        if keep {
            let prompt = self.prompt();
            self.write(session, channel, &prompt)?;
        }
        Ok(keep)
    }

    /// Full-screen fake program; redrawn on every resize so PTY negotiation is
    /// visually observable.
    fn render_app(&self, kind: &str) -> String {
        let term_w = self.dims.0 as usize;
        let term_h = self.dims.1 as usize;
        // A compact, fixed-width panel reads much better than a full-bleed box
        // and can never trip the terminal's auto-wrap.
        let inner = term_w.saturating_sub(8).clamp(34, 88);
        let body_rows = term_h.saturating_sub(6).clamp(3, 18);

        let mut out = String::from("\x1b[?1049h\x1b[2J\x1b[H");
        let title = format!(" {kind} (fake)  {term_w}x{term_h} ");
        out.push_str(&format!(
            "\x1b[38;5;39m┌{}\x1b[0m\r\n",
            pad_with(&title, inner, '─')
        ));

        let push_row = |out: &mut String, content: String| {
            out.push_str(&format!(
                "\x1b[38;5;39m│\x1b[0m{}\x1b[38;5;39m│\x1b[0m\r\n",
                pad_with(&content, inner, ' ')
            ));
        };

        push_row(&mut out, " press q to quit / resize me to redraw".to_string());
        push_row(&mut out, format!(" pty {}x{}", self.dims.0, self.dims.1));

        let bar_width = inner.saturating_sub(16).max(6);
        for row in 1..=body_rows {
            let filled = (row * bar_width) / body_rows;
            let percent = (row * 100) / body_rows;
            push_row(
                &mut out,
                format!(
                    " cpu [{}{}] {percent:>3}%",
                    "#".repeat(filled),
                    "-".repeat(bar_width - filled)
                ),
            );
        }

        out.push_str(&format!("\x1b[38;5;39m└{}┘\x1b[0m", "─".repeat(inner)));
        out
    }

    fn leave_app(&mut self, session: &mut Session, channel: ChannelId) -> Result<(), russh::Error> {
        self.mode = Mode::Shell;
        self.write(session, channel, "\x1b[?1049l\x1b[2J\x1b[H")?;
        let prompt = self.prompt();
        self.write(session, channel, &prompt)
    }
}

impl server::Handler for TestHandler {
    type Error = russh::Error;

    async fn auth_password(
        &mut self,
        user: &str,
        password: &str,
    ) -> Result<Auth, Self::Error> {
        let ok = user == self.username && password == self.password;
        tracing::info!(user, ok, "password authentication attempt");
        if ok {
            self.authenticated = true;
            Ok(Auth::Accept)
        } else {
            Ok(Auth::reject())
        }
    }

    async fn channel_open_session(
        &mut self,
        _channel: Channel<Msg>,
        reply: server::ChannelOpenHandle,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        reply.accept().await;
        Ok(())
    }

    async fn pty_request(
        &mut self,
        channel: ChannelId,
        term: &str,
        col_width: u32,
        row_height: u32,
        _pix_width: u32,
        _pix_height: u32,
        _modes: &[(russh::Pty, u32)],
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        self.dims = (col_width.max(20), row_height.max(5));
        tracing::info!(term, cols = self.dims.0, rows = self.dims.1, "pty requested");
        session.channel_success(channel)?;
        Ok(())
    }

    async fn shell_request(
        &mut self,
        channel: ChannelId,
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        session.channel_success(channel)?;
        let banner = self.banner();
        self.write(session, channel, &banner)?;
        let prompt = self.prompt();
        self.write(session, channel, &prompt)?;
        Ok(())
    }

    async fn window_change_request(
        &mut self,
        channel: ChannelId,
        col_width: u32,
        row_height: u32,
        _pix_width: u32,
        _pix_height: u32,
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        self.dims = (col_width.max(20), row_height.max(5));
        tracing::info!(cols = self.dims.0, rows = self.dims.1, "window change");

        match self.mode {
            Mode::App(kind) => {
                let frame = self.render_app(kind);
                self.write(session, channel, &frame)?;
            }
            Mode::Shell => {
                let note = format!(
                    "\r\n\x1b[38;5;244m[pty resized to {}×{}]\x1b[0m\r\n",
                    self.dims.0, self.dims.1
                );
                self.write(session, channel, &note)?;
                let prompt = self.prompt();
                self.write(session, channel, &prompt)?;
            }
        }
        Ok(())
    }

    async fn data(
        &mut self,
        channel: ChannelId,
        data: &[u8],
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        // Any key quits a fake full-screen app.
        if let Mode::App(_) = self.mode {
            if data.contains(&b'q') {
                return self.leave_app(session, channel);
            }
            return Ok(());
        }

        let mut echoed = String::new();
        for &byte in data {
            if self.escape_remaining > 0 {
                self.escape_remaining -= 1;
                continue;
            }
            match byte {
                0x1b => self.escape_remaining = 2,
                b'\r' | b'\n' => {
                    self.flush(session, channel, &mut echoed)?;
                    self.execute(session, channel)?;
                }
                0x7f | 0x08 => {
                    if self.line.pop().is_some() {
                        echoed.push_str("\x08 \x08");
                    }
                }
                0x03 => {
                    self.line.clear();
                    echoed.push_str("^C\r\n");
                    self.flush(session, channel, &mut echoed)?;
                    let prompt = self.prompt();
                    self.write(session, channel, &prompt)?;
                }
                0x04 => {
                    if self.line.is_empty() {
                        self.write(session, channel, "\r\nlogout\r\n")?;
                        session.exit_status_request(channel, 0)?;
                        session.eof(channel)?;
                        session.close(channel)?;
                        return Ok(());
                    }
                }
                b if b >= 0x20 => {
                    self.line.push(b);
                    echoed.push(b as char);
                }
                _ => {}
            }
        }
        self.flush(session, channel, &mut echoed)?;
        Ok(())
    }
}

fn pad_with(text: &str, width: usize, fill: char) -> String {
    let visible: String = text.chars().take(width).collect();
    let missing = width.saturating_sub(visible.chars().count());
    format!("{visible}{}", fill.to_string().repeat(missing))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_host_key_parses_and_matches_the_documented_fingerprint() {
        let key = PrivateKey::from_openssh(HOST_KEY_PEM.trim()).unwrap();
        let public = key.public_key();
        let fingerprint = public.fingerprint(russh::keys::HashAlg::Sha256).to_string();
        assert_eq!(fingerprint, HOST_KEY_FINGERPRINT);
    }

    #[test]
    fn padding_respects_the_requested_width() {
        assert_eq!(pad_with("ab", 5, '-'), "ab---");
        assert_eq!(pad_with("abcdef", 3, '-'), "abc");
    }
}
