//! Standalone runner for the phase-2 test SSH server.
//!
//! ```text
//! cargo run --features test-server --bin ssh-test-server
//! ```

use std::net::SocketAddr;

use russh::server::Server as _;
use tokio::net::TcpListener;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    use tracing_subscriber::EnvFilter;

    let filter = EnvFilter::try_from_env("LEONSSH_LOG")
        .unwrap_or_else(|_| EnvFilter::new("leonssh_lib=debug,russh=warn,info"));
    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .init();

    let addr: SocketAddr = std::env::var("LEONSSH_TEST_SERVER_ADDR")
        .unwrap_or_else(|_| "127.0.0.1:2222".to_string())
        .parse()?;

    let listener = TcpListener::bind(addr).await?;
    let bound = listener.local_addr()?;

    println!("┌─ LeonSSH test SSH server ────────────────────────────");
    println!("│ listening : {bound}");
    println!("│ user/pass : {} / {}", leonssh_lib::ssh_test_server::TEST_USER, leonssh_lib::ssh_test_server::TEST_PASSWORD);
    println!("│ host key  : {}", leonssh_lib::ssh_test_server::HOST_KEY_FINGERPRINT);
    println!("│ stop      : Ctrl+C");
    println!("└──────────────────────────────────────────────────────");

    let mut server = leonssh_lib::ssh_test_server::TestServer::new();
    server
        .run_on_socket(leonssh_lib::ssh_test_server::config(), &listener)
        .await?;
    Ok(())
}
