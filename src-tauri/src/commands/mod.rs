//! Tauri command surface.
//!
//! `commands` stays deliberately thin: argument validation, state lookup and a
//! single call into the domain layer.

pub mod editor;
pub mod forward;
pub mod local;
pub mod sessions;
pub mod sftp;
pub mod ssh;
pub mod transfer;
