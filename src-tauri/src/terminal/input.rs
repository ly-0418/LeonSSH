//! Keystroke formatting helpers.
//!
//! Logging raw keystrokes would inject control characters into the log file
//! (ESC sequences, newlines, …), which is both unreadable and a mild log
//! injection risk. Everything that reaches `tracing` goes through
//! [`escape_preview`] first.

const PREVIEW_CHARS: usize = 64;

/// Renders terminal input as a single readable, escape-free line.
pub fn escape_preview(data: &[u8]) -> String {
    let lossy = String::from_utf8_lossy(data);
    let mut out = String::with_capacity(PREVIEW_CHARS + 8);
    let mut truncated = false;

    for (index, ch) in lossy.chars().enumerate() {
        if index >= PREVIEW_CHARS {
            truncated = true;
            break;
        }
        match ch {
            '\r' => out.push_str("\\r"),
            '\n' => out.push_str("\\n"),
            '\t' => out.push_str("\\t"),
            '\u{1b}' => out.push_str("\\x1b"),
            c if (c as u32) < 0x20 || c as u32 == 0x7f => {
                out.push_str(&format!("\\x{:02x}", c as u32));
            }
            c => out.push(c),
        }
    }

    if truncated || lossy.chars().count() > PREVIEW_CHARS {
        out.push('…');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escapes_carriage_return_and_escape_key() {
        assert_eq!(escape_preview(b"ls\r"), "ls\\r");
        assert_eq!(escape_preview(b"\x1b[A"), "\\x1b[A");
        assert_eq!(escape_preview(b"a\tb"), "a\\tb");
    }

    #[test]
    fn keeps_utf8_text_readable() {
        assert_eq!(escape_preview("你好".as_bytes()), "你好");
    }

    #[test]
    fn truncates_long_input() {
        let long = vec![b'x'; 200];
        let preview = escape_preview(&long);
        assert!(preview.ends_with('…'));
        assert_eq!(preview.chars().count(), PREVIEW_CHARS + 1);
    }
}
