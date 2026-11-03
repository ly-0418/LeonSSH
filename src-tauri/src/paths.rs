//! Filesystem layout and logging bootstrap.
//!
//! Requirement: **all configuration and cache files live under the install
//! directory**. Resolution order:
//!
//! 1. `LEONSSH_DATA_DIR` (explicit override, handy for portable/dev runs)
//! 2. `<install_dir>/data` (the default; the install dir is the folder that
//!    contains `LeonSSH.exe`)
//! 3. `%LOCALAPPDATA%\LeonSSH\data` — only if the install dir is read-only
//!    (e.g. a per-machine install under `C:\Program Files`). This case is
//!    logged loudly and surfaced in the UI status bar.

use std::fs;
use std::path::{Path, PathBuf};

const DATA_DIR_NAME: &str = "data";
const WRITE_PROBE: &str = ".leonssh-write-probe";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DataDirMode {
    /// Data lives next to the executable (default, expected).
    InstallDir,
    /// The install dir was not writable, so we degraded to LOCALAPPDATA.
    UserFallback,
}

impl DataDirMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::InstallDir => "install-dir",
            Self::UserFallback => "user-fallback",
        }
    }
}

#[derive(Debug, Clone)]
pub struct Paths {
    /// Folder containing the executable (or the cargo target dir in dev).
    pub install_dir: PathBuf,
    /// Root for config, cache, logs and (phase 3) the SQLite database.
    pub data_dir: PathBuf,
    pub logs_dir: PathBuf,
    pub cache_dir: PathBuf,
    /// WebView2 user data folder — keeps the browser cache out of %LOCALAPPDATA%.
    pub webview_dir: PathBuf,
    pub mode: DataDirMode,
}

impl Paths {
    pub fn resolve() -> Self {
        let exe = std::env::current_exe().unwrap_or_else(|_| PathBuf::from("."));
        let install_dir = exe
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from("."));

        if let Some(raw) = std::env::var_os("LEONSSH_DATA_DIR") {
            let dir = PathBuf::from(raw);
            if ensure_writable(&dir).is_ok() {
                return Self::build(install_dir, dir, DataDirMode::InstallDir);
            }
            eprintln!(
                "[paths] LEONSSH_DATA_DIR={} is not writable, ignoring",
                dir.display()
            );
        }

        let preferred = install_dir.join(DATA_DIR_NAME);
        match ensure_writable(&preferred) {
            Ok(()) => Self::build(install_dir, preferred, DataDirMode::InstallDir),
            Err(err) => {
                let fallback = fallback_data_dir();
                if let Err(fallback_err) = ensure_writable(&fallback) {
                    eprintln!(
                        "[paths] cannot create data dir at {} ({fallback_err}); falling back to temp",
                        fallback.display()
                    );
                }
                eprintln!(
                    "[paths] install dir {} is not writable ({err}); using {} instead",
                    install_dir.display(),
                    fallback.display()
                );
                Self::build(install_dir, fallback, DataDirMode::UserFallback)
            }
        }
    }

    pub(crate) fn build(install_dir: PathBuf, data_dir: PathBuf, mode: DataDirMode) -> Self {
        let logs_dir = data_dir.join("logs");
        let cache_dir = data_dir.join("cache");
        let webview_dir = data_dir.join("webview");
        for dir in [&logs_dir, &cache_dir, &webview_dir] {
            if let Err(err) = fs::create_dir_all(dir) {
                eprintln!("[paths] cannot create {}: {err}", dir.display());
            }
        }
        Self {
            install_dir,
            data_dir,
            logs_dir,
            cache_dir,
            webview_dir,
            mode,
        }
    }

}

fn fallback_data_dir() -> PathBuf {
    let base = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    base.join("LeonSSH").join(DATA_DIR_NAME)
}

/// Creates `dir` and proves it is writable with a short-lived probe file.
pub fn ensure_writable(dir: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dir)?;
    let probe = dir.join(WRITE_PROBE);
    fs::write(&probe, b"ok")?;
    match fs::remove_file(&probe) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(err),
    }
}

/// Installs a rolling file logger inside `<data_dir>/logs` plus a stderr mirror.
///
/// Logs never contain credentials: phase 1 has none, and phase 3 routes every
/// secret through the keyring without ever formatting it.
/// Formats log lines in local wall-clock time (no network, no extra crates).
struct LocalClock;

impl tracing_subscriber::fmt::time::FormatTime for LocalClock {
    fn format_time(
        &self,
        w: &mut tracing_subscriber::fmt::format::Writer<'_>,
    ) -> std::fmt::Result {
        #[cfg(windows)]
        {
            use windows_sys::Win32::System::SystemInformation::GetLocalTime;
            let mut st: windows_sys::Win32::Foundation::SYSTEMTIME = unsafe { std::mem::zeroed() };
            unsafe { GetLocalTime(&mut st) };
            return write!(
                w,
                "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}",
                st.wYear, st.wMonth, st.wDay, st.wHour, st.wMinute, st.wSecond, st.wMilliseconds
            );
        }
        #[cfg(not(windows))]
        {
            write!(w, "{}", "1970-01-01T00:00:00.000")
        }
    }
}

pub fn init_tracing(paths: &Paths) {
    use tracing_subscriber::layer::SubscriberExt;
    use tracing_subscriber::util::SubscriberInitExt;
    use tracing_subscriber::EnvFilter;

    let filter = EnvFilter::try_from_env("LEONSSH_LOG")
        .unwrap_or_else(|_| EnvFilter::new("leonssh_lib=debug,tauri=info,wry=warn,info"));

    let file_appender = tracing_appender::rolling::daily(&paths.logs_dir, "leonssh.log");
    let (file_writer, guard) = tracing_appender::non_blocking(file_appender);
    // The guard must outlive the process; leaking is the documented pattern.
    Box::leak(Box::new(guard));

    let file_layer = tracing_subscriber::fmt::layer().with_timer(LocalClock)
        .with_writer(file_writer)
        .with_ansi(false)
        .with_target(true);

    let stderr_layer = tracing_subscriber::fmt::layer().with_timer(LocalClock)
        .with_writer(std::io::stderr)
        .with_ansi(false)
        .with_target(true);

    let _ = tracing_subscriber::registry()
        .with(filter)
        .with(file_layer)
        .with(stderr_layer)
        .try_init();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unique_dir(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("leonssh-{tag}-{nanos}"))
    }

    #[test]
    fn ensure_writable_creates_the_directory() {
        let dir = unique_dir("writable");
        assert!(ensure_writable(&dir).is_ok());
        assert!(dir.is_dir());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn build_creates_all_subdirectories() {
        let root = unique_dir("layout");
        let paths = Paths::build(PathBuf::from("C:/fake"), root.clone(), DataDirMode::InstallDir);
        assert!(paths.logs_dir.is_dir());
        assert!(paths.cache_dir.is_dir());
        assert!(paths.webview_dir.is_dir());
        assert_eq!(paths.mode.as_str(), "install-dir");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn ensure_writable_is_idempotent() {
        let dir = unique_dir("idempotent");
        assert!(ensure_writable(&dir).is_ok());
        assert!(ensure_writable(&dir).is_ok());
        let _ = fs::remove_dir_all(&dir);
    }
}
