//! Shutdown context timeouts for MCP server teardown.
//!
//! Different shutdown triggers need different timing: closing the app should
//! be fast so the UI doesn't hang, while a factory reset can afford to wait
//! for servers to release resources cleanly.

use std::time::Duration;

#[derive(Debug, Clone, Copy)]
pub enum ShutdownContext {
    AppExit,       // User closing app - be fast
    ManualRestart, // User restarting servers - be thorough
    FactoryReset,  // Deleting data - be very thorough
}

impl ShutdownContext {
    pub fn per_server_timeout(&self) -> Duration {
        match self {
            Self::AppExit => Duration::from_millis(500),
            Self::ManualRestart => Duration::from_secs(2),
            Self::FactoryReset => Duration::from_secs(5),
        }
    }

    pub fn overall_timeout(&self) -> Duration {
        match self {
            Self::AppExit => Duration::from_millis(1500),
            Self::ManualRestart => Duration::from_secs(5),
            Self::FactoryReset => Duration::from_secs(10),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_shutdown_context_app_exit_timeouts() {
        let ctx = ShutdownContext::AppExit;
        assert_eq!(ctx.per_server_timeout(), Duration::from_millis(500));
        assert_eq!(ctx.overall_timeout(), Duration::from_millis(1500));
    }

    #[test]
    fn test_shutdown_context_manual_restart_timeouts() {
        let ctx = ShutdownContext::ManualRestart;
        assert_eq!(ctx.per_server_timeout(), Duration::from_secs(2));
        assert_eq!(ctx.overall_timeout(), Duration::from_secs(5));
    }

    #[test]
    fn test_shutdown_context_factory_reset_timeouts() {
        let ctx = ShutdownContext::FactoryReset;
        assert_eq!(ctx.per_server_timeout(), Duration::from_secs(5));
        assert_eq!(ctx.overall_timeout(), Duration::from_secs(10));
    }
}
