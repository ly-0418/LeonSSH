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

/// Opens a local file and returns the launched process id (when known).
pub fn open_path(target: &Path) -> Result<Option<u32>, AppError> {
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
        use windows_sys::Win32::Foundation::CloseHandle;
        use windows_sys::Win32::System::Threading::GetProcessId;
        use windows_sys::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW};
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

        let mut info: SHELLEXECUTEINFOW = unsafe { std::mem::zeroed() };
        info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
        info.fMask = SEE_MASK_NOCLOSEPROCESS;
        info.lpVerb = operation.as_ptr();
        info.lpFile = file.as_ptr();
        info.nShow = SW_SHOWNORMAL;

        let launched = unsafe { ShellExecuteExW(&mut info) };
        if launched != 0 && !info.hProcess.is_null() {
            let pid = unsafe { GetProcessId(info.hProcess) };
            unsafe { CloseHandle(info.hProcess) };
            tracing::info!(path = %target.display(), pid, "opened with the default application");
            return Ok(Some(pid));
        }

        tracing::info!(
            path = %target.display(),
            "no shell association, falling back to notepad"
        );
        let child = std::process::Command::new("notepad.exe")
            .arg(target)
            .spawn()
            .map_err(|err| AppError::Internal(format!("启动记事本失败: {err}")))?;
        Ok(Some(child.id()))
    }

    #[cfg(not(windows))]
    {
        Err(AppError::Internal("仅支持 Windows".into()))
    }
}

/// True while the process started for an edit session is still running.
pub fn process_alive(pid: u32) -> bool {
    #[cfg(windows)]
    {
        use windows_sys::Win32::Foundation::CloseHandle;
        use windows_sys::Win32::System::Threading::{
            GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
        };

        const STILL_ACTIVE: u32 = 259;
        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if handle.is_null() {
                return false;
            }
            let mut code: u32 = 0;
            let ok = GetExitCodeProcess(handle, &mut code);
            CloseHandle(handle);
            ok != 0 && code == STILL_ACTIVE
        }
    }

    #[cfg(not(windows))]
    {
        let _ = pid;
        false
    }
}

#[tauri::command]
pub fn local_open_file(path: String) -> Result<(), AppError> {
    open_path(Path::new(&path)).map(|_| ())
}

/// Current application version (shown in the settings drawer).
#[tauri::command]
pub fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Opens an https URL in the default browser (used by "check for updates").
#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), AppError> {
    if !url.starts_with("https://") {
        return Err(AppError::InvalidArgument("只允许打开 https 链接".into()));
    }
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::UI::Shell::ShellExecuteW;
        use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

        fn wide(value: &str) -> Vec<u16> {
            value.encode_utf16().chain(std::iter::once(0)).collect()
        }
        let operation = wide("open");
        let target = wide(&url);
        let result = unsafe {
            ShellExecuteW(
                std::ptr::null_mut(),
                operation.as_ptr(),
                target.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                SW_SHOWNORMAL,
            )
        };
        if (result as isize) <= 32 {
            return Err(AppError::Internal("无法打开浏览器".into()));
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        Err(AppError::Internal("仅支持 Windows".into()))
    }
}