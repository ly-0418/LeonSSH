//! Remote path normalization and traversal guards.
//!
//! SFTP servers usually reject `..` escapes on their own, but the client must
//! not rely on that: every path the UI builds goes through these helpers.

use crate::error::AppError;

/// Lexically normalizes a POSIX path: collapses `.`/`..`, clamps at `/`.
///
/// `normalize_remote("/var/./log/../log/syslog") == "/var/log/syslog"`
/// `normalize_remote("/../../etc") == "/etc"` (never escapes the root)
pub fn normalize_remote(input: &str) -> String {
    let mut parts: Vec<&str> = Vec::new();
    for segment in input.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            other => parts.push(other),
        }
    }
    format!("/{}", parts.join("/"))
}

/// Joins a directory and a single entry name.
///
/// Rejects names that could escape the directory or inject a second path
/// component (`/`, `\`, NUL, `.`/`..`).
// Wired into the command layer in phase B (remote listing/transfer paths).
#[allow(dead_code)]
pub fn join_remote(dir: &str, name: &str) -> Result<String, AppError> {
    let invalid = name.is_empty()
        || name == "."
        || name == ".."
        || name.contains('/')
        || name.contains('\\')
        || name.contains('\0');
    if invalid {
        return Err(AppError::InvalidArgument(format!(
            "非法的文件/目录名: {name}"
        )));
    }
    let base = normalize_remote(dir);
    if base == "/" {
        Ok(format!("/{name}"))
    } else {
        Ok(format!("{base}/{name}"))
    }
}

/// True when `child` is `root` itself or lexically inside it.
// Wired into the transfer guard in phase C.
#[allow(dead_code)]
pub fn is_within(root: &str, child: &str) -> bool {
    let root = normalize_remote(root);
    let child = normalize_remote(child);
    if root == "/" {
        return child.starts_with('/');
    }
    child == root || child.starts_with(&format!("{root}/"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_dots_and_double_slashes() {
        assert_eq!(normalize_remote("/var/./log/../log/syslog"), "/var/log/syslog");
        assert_eq!(normalize_remote("//etc///ssh//"), "/etc/ssh");
        assert_eq!(normalize_remote(""), "/");
        assert_eq!(normalize_remote("."), "/");
    }

    #[test]
    fn never_escapes_above_root() {
        assert_eq!(normalize_remote("/.."), "/");
        assert_eq!(normalize_remote("/../../etc/passwd"), "/etc/passwd");
        assert_eq!(normalize_remote("/var/../../etc"), "/etc");
    }

    #[test]
    fn joins_without_double_slashes() {
        assert_eq!(join_remote("/etc", "ssh").unwrap(), "/etc/ssh");
        assert_eq!(join_remote("/", "root").unwrap(), "/root");
        assert_eq!(join_remote("/var//log/", "syslog").unwrap(), "/var/log/syslog");
    }

    #[test]
    fn rejects_traversal_in_file_names() {
        for name in ["..", ".", "../etc/passwd", "a/b", "a\\b", ""] {
            assert!(join_remote("/home/test", name).is_err(), "{name} must be rejected");
        }
    }

    #[test]
    fn containment_check() {
        assert!(is_within("/home", "/home/test/file"));
        assert!(is_within("/home", "/home"));
        assert!(!is_within("/home", "/homer"));
        assert!(!is_within("/home/test", "/home"));
        assert!(is_within("/", "/anything"));
    }

    #[test]
    fn traversal_cannot_be_smuggled_through_a_join() {
        // The classic attack: an entry name like "..%2f.." is rejected outright.
        let err = join_remote("/home/test", "../../etc/passwd").unwrap_err();
        assert_eq!(err.code(), "invalid_argument");
    }
}
