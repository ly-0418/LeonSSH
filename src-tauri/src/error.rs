//! Error type shared by every Tauri command.
//!
//! Commands return `Result<T, AppError>`; the type serializes to
//! `{ "code": "...", "message": "..." }` so the frontend can branch on `code`
//! while still showing a human readable `message`.

use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("会话不存在: {0}")]
    SessionNotFound(String),

    #[error("会话已关闭: {0}")]
    SessionClosed(String),

    #[error("参数非法: {0}")]
    InvalidArgument(String),

    #[error("主机密钥校验失败: {0}")]
    HostKeyMismatch(String),

    #[error("SSH 错误: {0}")]
    Ssh(String),

    #[error("未找到: {0}")]
    NotFound(String),

    #[error("凭据存储失败: {0}")]
    Secret(String),

    #[error("SFTP 错误: {0}")]
    Sftp(String),

    #[error("端口转发错误: {0}")]
    Forward(String),

    #[error("传输错误: {0}")]
    Transfer(String),

    #[error("内部错误: {0}")]
    Internal(String),
}

impl AppError {
    /// Stable machine readable identifier, mirrored in `src/lib/ipc/errors.ts`.
    pub fn code(&self) -> &'static str {
        match self {
            Self::SessionNotFound(_) => "session_not_found",
            Self::SessionClosed(_) => "session_closed",
            Self::InvalidArgument(_) => "invalid_argument",
            Self::HostKeyMismatch(_) => "host_key_mismatch",
            Self::Ssh(_) => "ssh_error",
            Self::NotFound(_) => "not_found",
            Self::Secret(_) => "secret_error",
            Self::Sftp(_) => "sftp_error",
            Self::Forward(_) => "forward_error",
            Self::Transfer(_) => "transfer_error",
            Self::Internal(_) => "internal",
        }
    }
}

impl From<sqlx::Error> for AppError {
    fn from(value: sqlx::Error) -> Self {
        tracing::error!(error = %value, "sqlite error");
        Self::Internal(format!("数据库错误: {value}"))
    }
}

impl From<std::io::Error> for AppError {
    fn from(value: std::io::Error) -> Self {
        Self::Internal(value.to_string())
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut state = serializer.serialize_struct("AppError", 2)?;
        state.serialize_field("code", self.code())?;
        state.serialize_field("message", &self.to_string())?;
        state.end()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_serializes_to_code_and_message() {
        let err = AppError::SessionNotFound("s7".into());
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(json["code"], "session_not_found");
        assert_eq!(json["message"], "会话不存在: s7");
    }

    #[test]
    fn codes_are_stable() {
        assert_eq!(AppError::InvalidArgument("x".into()).code(), "invalid_argument");
        assert_eq!(AppError::SessionClosed("x".into()).code(), "session_closed");
        assert_eq!(AppError::HostKeyMismatch("x".into()).code(), "host_key_mismatch");
        assert_eq!(AppError::Ssh("x".into()).code(), "ssh_error");
        assert_eq!(AppError::NotFound("x".into()).code(), "not_found");
        assert_eq!(AppError::Secret("x".into()).code(), "secret_error");
        assert_eq!(AppError::Internal("x".into()).code(), "internal");
    }
}
