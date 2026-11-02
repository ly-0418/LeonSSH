//! Tauri command surface.
//!
//! `commands` stays deliberately thin: argument validation, state lookup and a
//! single call into the session layer. Transport details live in `terminal`.

pub mod ssh;
