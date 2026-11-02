//! Transport-agnostic terminal session layer.
//!
//! * `sink`     – where bytes go (Tauri binary channel)
//! * `pump`     – bounded queue -> coalesced frames -> sink
//! * `registry` – session handle + cooperative shutdown
//! * `input`    – keystroke formatting for logs

pub mod input;
pub mod pump;
pub mod registry;
pub mod sink;
