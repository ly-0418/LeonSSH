//! Local filesystem helpers the fs plugin cannot provide.
//!
//! Directory browsing/CRUD goes through `@tauri-apps/plugin-fs`; Rust only
//! supplies the list of drive roots and extends the plugin's runtime scope so
//! the user can browse the whole machine from the file manager.

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
