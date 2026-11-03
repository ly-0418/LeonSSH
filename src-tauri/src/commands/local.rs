//! Local filesystem helpers the fs plugin cannot provide.
//!
//! Directory browsing/CRUD goes through `@tauri-apps/plugin-fs`; Rust supplies
//! the drive list, widens the plugin's runtime scope, and opens files with the
//! Windows default application.

use std::path::Path;

use crate::error::AppError;

/// Existing drive roots, e.g. `["C:\\", "D:\\"]`.
pub fn drive_roots() -> Vec<String> {
    let mut roots = Vec::new();
    for letter in b'A'..=b'Z' {
        let root = format!("{}:\\", letter as char);
        if std::path::Path::new(&root).exists() {
            roots.push(root);
        }
    }
    roots
}

#[tauri::command]
pub fn local_roots() -> Result<Vec<String>, AppError> {
    let roots = drive_roots();
    tracing::debug!(roots = ?roots, "local drive roots");
    Ok(roots)
}

/// Opens a local file with its associated application.
///
/// When Windows has no association for the extension (or the shell call fails)
/// the file is opened in Notepad instead.
pub fn open_path(target: &Path) -> Result<(), AppError> {
    if !target.is_file() {
        return Err(AppError::InvalidArgument(format!(
            "本地文件不存在: {}",
            target.display()
        )));
    }
    if target.to_string_lossy().starts_with("\\\\") {
        return Err(AppError::InvalidArgument(
            "不从网络路径直接启动程序".into(),
        ));
    }

    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::UI::Shell::ShellExecuteW;
        use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

        fn wide(value: &str) -> Vec<u16> {
            value.encode_utf16().chain(std::iter::once(0)).collect()
        }

        let file: Vec<u16> = target
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let operation = wide("open");
        // ShellExecuteW returns a value <= 32 on failure; 31 means "no association".
        let result = unsafe {
            ShellExecuteW(
                std::ptr::null_mut(),
                operation.as_ptr(),
                file.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                SW_SHOWNORMAL,
            )
        };
        if (result as isize) <= 32 {
            tracing::info!(
                path = %target.display(),
                code = result as isize,
                "no shell association, falling back to notepad"
            );
            std::process::Command::new("notepad.exe")
                .arg(target)
                .spawn()
                .map_err(|err| AppError::Internal(format!("启动记事本失败: {err}")))?;
        }
        Ok(())
    }

    #[cfg(not(windows))]
    {
        Err(AppError::Internal("仅支持 Windows".into()))
    }
}

#[tauri::command]
pub fn local_open_file(path: String) -> Result<(), AppError> {
    open_path(Path::new(&path))
}
