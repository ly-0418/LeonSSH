//! Local filesystem helpers the fs plugin cannot provide.
//!
//! Directory browsing/CRUD goes through `@tauri-apps/plugin-fs`; Rust supplies
//! the drive list, widens the plugin's runtime scope, and opens files with the
//! Windows default application.

use tauri::State;
use crate::state::AppState;
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
/// Frontend crashes would otherwise be invisible; mirror them into the log.
#[tauri::command]
pub fn frontend_error(message: String) {
    tracing::error!(target: "frontend", "{message}");
}
/// Icon data for one file type, as BGRA pixels (frontend converts to a data URL).
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellIcon {
    pub width: u32,
    pub height: u32,
    pub bgra: Vec<u8>,
}

/// Windows shell icon for a name (file association or the directory icon).
#[tauri::command]
pub fn shell_icon(name: String, is_dir: bool) -> Result<ShellIcon, AppError> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::Foundation::HWND;
        use windows_sys::Win32::Graphics::Gdi::{
            DeleteObject, GetDC, GetDIBits, GetObjectW, ReleaseDC, BITMAP, BITMAPINFO,
            BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HGDIOBJ,
        };
        use windows_sys::Win32::Storage::FileSystem::{FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_NORMAL};
        use windows_sys::Win32::UI::Shell::{
            SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON, SHGFI_USEFILEATTRIBUTES,
        };
        use windows_sys::Win32::UI::WindowsAndMessaging::{DestroyIcon, GetIconInfo, ICONINFO};

        if name.contains('\\') || name.contains('/') || name.contains(':') {
            return Err(AppError::InvalidArgument("非法文件名".into()));
        }
        let mut shfi: SHFILEINFOW = unsafe { std::mem::zeroed() };
        let path: Vec<u16> = std::iter::once("C:\\icon\\")
            .flat_map(|prefix| prefix.encode_utf16())
            .chain(name.encode_utf16())
            .chain(std::iter::once(0))
            .collect();
        let attributes = if is_dir {
            FILE_ATTRIBUTE_DIRECTORY
        } else {
            FILE_ATTRIBUTE_NORMAL
        };
        let flags = SHGFI_ICON | SHGFI_USEFILEATTRIBUTES | SHGFI_LARGEICON;
        let ok = unsafe {
            SHGetFileInfoW(
                path.as_ptr(),
                attributes,
                &mut shfi,
                std::mem::size_of::<SHFILEINFOW>() as u32,
                flags,
            )
        };
        if ok == 0 || shfi.hIcon.is_null() {
            return Err(AppError::Internal("无法读取系统图标".into()));
        }

        let mut info: ICONINFO = unsafe { std::mem::zeroed() };
        if unsafe { GetIconInfo(shfi.hIcon, &mut info) } == 0 {
            unsafe { DestroyIcon(shfi.hIcon) };
            return Err(AppError::Internal("无法解析系统图标".into()));
        }

        let mut bitmap: BITMAP = unsafe { std::mem::zeroed() };
        let copied = unsafe {
            GetObjectW(
                info.hbmColor as HGDIOBJ,
                std::mem::size_of::<BITMAP>() as i32,
                &mut bitmap as *mut BITMAP as *mut _,
            )
        };
        let width = if copied > 0 { bitmap.bmWidth.max(1) } else { 32 };
        let height = if copied > 0 { bitmap.bmHeight.max(1) } else { 32 };
        let mut pixels = vec![0u8; (width * height * 4) as usize];

        let mut header: BITMAPINFO = unsafe { std::mem::zeroed() };
        header.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
        header.bmiHeader.biWidth = width;
        header.bmiHeader.biHeight = -height;
        header.bmiHeader.biPlanes = 1;
        header.bmiHeader.biBitCount = 32;
        header.bmiHeader.biCompression = BI_RGB;

        let dc = unsafe { GetDC(std::ptr::null_mut() as HWND) };
        let lines = unsafe {
            GetDIBits(
                dc,
                info.hbmColor,
                0,
                height as u32,
                pixels.as_mut_ptr() as *mut _,
                &mut header,
                DIB_RGB_COLORS,
            )
        };
        unsafe {
            ReleaseDC(std::ptr::null_mut() as HWND, dc);
            DeleteObject(info.hbmColor as HGDIOBJ);
            DeleteObject(info.hbmMask as HGDIOBJ);
            DestroyIcon(shfi.hIcon);
        }
        if lines == 0 {
            return Err(AppError::Internal("无法转换系统图标".into()));
        }

        // Some icons come without an alpha channel; derive it from luminance.
        let has_alpha = pixels.chunks_exact(4).any(|px| px[3] != 0);
        if !has_alpha {
            for px in pixels.chunks_exact_mut(4) {
                let luminance = ((px[0] as u32 + px[1] as u32 + px[2] as u32) / 3) as u8;
                px[3] = if luminance == 0 { 0 } else { 255 };
            }
        }

        Ok(ShellIcon {
            width: width as u32,
            height: height as u32,
            bgra: pixels,
        })
    }
    #[cfg(not(windows))]
    {
        let _ = (name, is_dir);
        Err(AppError::Internal("仅支持 Windows".into()))
    }
}
/// Confirmed shutdown: exits the app so every session is closed by the state
/// teardown (window.destroy() is blocked by the capability ACL).
#[tauri::command]
pub fn quit_app(app: tauri::AppHandle) {
    tracing::info!("quit requested by the frontend");
    app.exit(0);
}
/// Last lines of the newest log file: shown in the settings drawer so users do
/// not have to hunt through `data/logs`.
#[tauri::command]
pub fn logs_tail(state: State<'_, AppState>, limit: Option<usize>) -> Result<String, AppError> {
    let limit = limit.unwrap_or(500).clamp(50, 500);
    let dir = state.paths().data_dir.join("logs");
    // Log timestamps are local wall-clock strings, so the floor must be parsed
    // the same way (not with SystemTime::now, which is UTC).
    let now_local = crate::paths::epoch_from_stamp(&crate::paths::now_stamp()).unwrap_or(0);
    let boot_local = crate::paths::boot_stamp()
        .and_then(crate::paths::epoch_from_stamp)
        .unwrap_or(0);
    // Only this run, and never more than three hours back.
    let floor = boot_local.max(now_local - 3 * 3600);

    let mut files: Vec<std::path::PathBuf> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let name = path.file_name().and_then(|value| value.to_str()).unwrap_or("");
            if name.starts_with("leonssh.log") {
                files.push(path);
            }
        }
    }
    // Daily files are named with their date, so a reverse name sort is newest first.
    files.sort_by(|a, b| b.file_name().cmp(&a.file_name()));

    let mut kept: Vec<String> = Vec::new();
    'outer: for path in files {
        let bytes = match std::fs::read(&path) {
            Ok(bytes) => bytes,
            Err(_) => continue,
        };
        let text = String::from_utf8_lossy(&bytes).to_string();
        for line in text.lines().rev() {
            if let Some(stamp) = line.get(0..19) {
                if let Some(secs) = crate::paths::epoch_from_stamp(stamp) {
                    if secs < floor {
                        break 'outer;
                    }
                }
            }
            kept.push(line.to_string());
            if kept.len() >= limit {
                break 'outer;
            }
        }
    }
    kept.reverse();
    Ok(kept.join("\n"))
}
