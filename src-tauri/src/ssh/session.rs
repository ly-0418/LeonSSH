//! Interactive shell session: PTY request, shell channel, and the byte pump
//! that connects russh to the transport-agnostic terminal pipeline.

use std::sync::Arc;

use bytes::Bytes;
use russh::client::Msg;
use russh::{Channel, ChannelMsg, Disconnect};
use tokio::sync::{mpsc, watch};

use super::client::{self, SharedHandle};
use super::config::SshConfig;
use super::hostkey::{HostKeyVerdict, KnownHosts};
use super::SshError;

/// A shell channel that has finished the handshake (PTY + shell requested).
pub struct ShellSession {
    pub handle: SharedHandle,
    pub channel: Channel<Msg>,
    pub fingerprint: String,
    pub verdict: HostKeyVerdict,
}

/// Connects, requests a PTY and starts the shell.
pub async fn open(
    cfg: &SshConfig,
    known: Arc<KnownHosts>,
    cols: u16,
    rows: u16,
    routes: crate::forward::RemoteRoutes,
) -> Result<ShellSession, SshError> {
    let connection = client::connect(cfg, known, routes).await?;

    let channel = connection
        .handle
        .channel_open_session()
        .await
        .map_err(|err| SshError::Channel(err.to_string()))?;

    // `want_reply = false`: russh exposes the reply as a channel message, and a
    // terminal that refuses a PTY would still be usable for line output.
    channel
        .request_pty(
            false,
            &cfg.term,
            cols as u32,
            rows as u32,
            0,
            0,
            &[],
        )
        .await
        .map_err(|err| SshError::Channel(err.to_string()))?;

    channel
        .request_shell(true)
        .await
        .map_err(|err| SshError::Channel(err.to_string()))?;

    tracing::info!(
        target = %cfg.display_target(),
        cols,
        rows,
        term = %cfg.term,
        "shell channel opened"
    );

    Ok(ShellSession {
        handle: connection.handle,
        channel,
        fingerprint: connection.fingerprint,
        verdict: connection.verdict,
    })
}

/// Pumps bytes in both directions until the remote closes, the local side asks
/// to close, or any transport error occurs.
pub async fn run_io(
    session: ShellSession,
    mut input_rx: mpsc::Receiver<Vec<u8>>,
    mut resize_rx: watch::Receiver<(u16, u16)>,
    mut close_rx: watch::Receiver<bool>,
    out_tx: mpsc::Sender<Bytes>,
) {
    let ShellSession {
        handle, channel, ..
    } = session;
    let (mut read_half, write_half) = channel.split();

    let mut exit_code: Option<u32> = None;
    let mut remote_closed = false;

    loop {
        tokio::select! {
            biased;
            _ = close_rx.changed() => {
                tracing::info!("local close requested; sending EOF");
                break;
            }
            changed = resize_rx.changed() => {
                if changed.is_err() {
                    break;
                }
                let (cols, rows) = *resize_rx.borrow_and_update();
                if let Err(err) = write_half
                    .window_change(cols as u32, rows as u32, 0, 0)
                    .await
                {
                    tracing::warn!(%err, "window-change failed");
                    break;
                }
            }
            incoming = input_rx.recv() => {
                match incoming {
                    Some(bytes) => {
                        if let Err(err) = write_half.data_bytes(bytes).await {
                            tracing::warn!(%err, "sending input failed");
                            break;
                        }
                    }
                    None => break,
                }
            }
            message = read_half.wait() => {
                match message {
                    Some(ChannelMsg::Data { data }) => {
                        if out_tx.send(data).await.is_err() {
                            break;
                        }
                    }
                    Some(ChannelMsg::ExtendedData { data, ext }) => {
                        // ext == 1 is stderr; merge it into the terminal stream.
                        if ext == 1 && out_tx.send(data).await.is_err() {
                            break;
                        }
                    }
                    Some(ChannelMsg::ExitStatus { exit_status }) => {
                        exit_code = Some(exit_status);
                    }
                    Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => {
                        remote_closed = true;
                        break;
                    }
                    Some(_) => {}
                }
            }
        }
    }

    let footer = if remote_closed {
        match exit_code {
            Some(code) => format!("\r\n\x1b[38;5;244m── 远端会话已结束（exit {code}）──\x1b[0m\r\n"),
            None => "\r\n\x1b[38;5;244m── 远端会话已结束 ──\x1b[0m\r\n".to_string(),
        }
    } else {
        "\r\n\x1b[38;5;244m── 连接已关闭 ──\x1b[0m\r\n".to_string()
    };
    let _ = out_tx.send(Bytes::from(footer.into_bytes())).await;

    let _ = write_half.eof().await;
    let _ = write_half.close().await;
    let _ = handle.disconnect(Disconnect::ByApplication, "", "en").await;

    tracing::info!(?exit_code, remote_closed, "ssh session finished");
}
