pub mod oauth_server;
pub mod token_data;
pub mod pkce;
pub mod auth_storage;

pub use oauth_server::{LoginServer, ServerOptions, run_login_server};
pub use token_data::{TokenData, IdTokenInfo, AuthMode};
pub use auth_storage::{CodexAuth, load_auth, login_with_api_key, logout};

// OpenAI OAuth client ID for Codex (same as CLI)
pub const CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
pub const OPENAI_API_KEY_ENV_VAR: &str = "OPENAI_API_KEY";