use crate::protocol::CodexConfig;
use crate::services::{codex, session};
use crate::state::CodexState;
use crate::auth::{AuthMode, ServerOptions, run_login_server, login_with_api_key, logout, CLIENT_ID, load_auth};
use tauri::{AppHandle, State};
use std::fs;

// Re-export types for external use
pub use crate::services::session::Conversation;

#[tauri::command]
pub async fn load_sessions_from_disk() -> Result<Vec<Conversation>, String> {
    session::load_sessions_from_disk().await
}

#[tauri::command]
pub async fn start_codex_session(
    app: AppHandle,
    state: State<'_, CodexState>,
    session_id: String,
    config: CodexConfig,
) -> Result<(), String> {
    log::info!("Starting codex session: {}", session_id);
    codex::start_codex_session(app, state, session_id, config).await
}

#[tauri::command]
pub async fn send_message(
    state: State<'_, CodexState>,
    session_id: String,
    message: String,
) -> Result<(), String> {
    codex::send_message(state, session_id, message).await
}

#[tauri::command]
pub async fn send_message_with_media(
    state: State<'_, CodexState>,
    session_id: String,
    message: String,
    media_paths: Vec<String>,
) -> Result<(), String> {
    log::debug!("🔄 [Tauri Command] send_message_with_media called:");
    log::debug!("  📝 session_id: {}", session_id);
    log::debug!("  💬 message: {}", message);
    log::debug!("  📸 media_paths: {:?}", media_paths);
    log::debug!("  📊 media_paths count: {}", media_paths.len());
    
    codex::send_message_with_media(state, session_id, message, media_paths).await
}

#[tauri::command]
pub async fn approve_execution(
    state: State<'_, CodexState>,
    session_id: String,
    approval_id: String,
    approved: bool,
) -> Result<(), String> {
    codex::approve_execution(state, session_id, approval_id, approved).await
}

#[tauri::command]
pub async fn stop_session(state: State<'_, CodexState>, session_id: String) -> Result<(), String> {
    codex::stop_session(state, session_id).await
}

#[tauri::command]
pub async fn pause_session(state: State<'_, CodexState>, session_id: String) -> Result<(), String> {
    codex::pause_session(state, session_id).await
}

#[tauri::command]
pub async fn close_session(state: State<'_, CodexState>, session_id: String) -> Result<(), String> {
    codex::close_session(state, session_id).await
}

#[tauri::command]
pub async fn get_running_sessions(state: State<'_, CodexState>) -> Result<Vec<String>, String> {
    codex::get_running_sessions(state).await
}

#[tauri::command]
pub async fn check_codex_version() -> Result<String, String> {
    codex::check_codex_version().await
}

#[tauri::command]
pub async fn delete_session_file(file_path: String) -> Result<(), String> {
    session::delete_session_file(file_path).await
}

#[tauri::command]
pub async fn get_latest_session_id() -> Result<Option<String>, String> {
    session::get_latest_session_id().await
}

#[tauri::command]
pub async fn get_session_files() -> Result<Vec<String>, String> {
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    let sessions_dir = home.join(".codex").join("sessions");
    
    if !sessions_dir.exists() {
        return Ok(vec![]);
    }
    
    let mut session_files = Vec::new();
    
    // Walk through year/month/day directories
    if let Ok(entries) = fs::read_dir(&sessions_dir) {
        for entry in entries.flatten() {
            if entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
                let year_path = entry.path();
                if let Ok(month_entries) = fs::read_dir(&year_path) {
                    for month_entry in month_entries.flatten() {
                        if month_entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
                            let month_path = month_entry.path();
                            if let Ok(day_entries) = fs::read_dir(&month_path) {
                                for day_entry in day_entries.flatten() {
                                    if day_entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
                                        let day_path = day_entry.path();
                                        if let Ok(file_entries) = fs::read_dir(&day_path) {
                                            for file_entry in file_entries.flatten() {
                                                if let Some(filename) = file_entry.file_name().to_str() {
                                                    if filename.ends_with(".jsonl") {
                                                        session_files.push(file_entry.path().to_string_lossy().to_string());
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    
    Ok(session_files)
}

#[tauri::command]
pub async fn read_session_file(file_path: String) -> Result<String, String> {
    fs::read_to_string(&file_path).map_err(|e| format!("Failed to read session file: {}", e))
}

#[tauri::command]
pub async fn read_history_file() -> Result<String, String> {
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    let history_path = home.join(".codex").join("history.jsonl");
    
    if !history_path.exists() {
        return Ok(String::new());
    }
    
    fs::read_to_string(&history_path).map_err(|e| format!("Failed to read history file: {}", e))
}

// OAuth Authentication Commands

#[tauri::command]
pub async fn get_auth_status() -> Result<Option<String>, String> {
    let codex_home = dirs::home_dir()
        .ok_or("Could not find home directory")?
        .join(".codex");

    // 1) Check for environment variable first (matches CLI behavior)
    if let Ok(api_key) = std::env::var("OPENAI_API_KEY") {
        if !api_key.is_empty() {
            return Ok(Some("api_key".to_string()));
        }
    }

    // 2) Load auth via shared helper (reads ~/.codex/auth.json like the CLI)
    match load_auth(&codex_home, false).await {
        Ok(Some(auth)) => {
            match auth.mode {
                AuthMode::ApiKey => Ok(Some("api_key".to_string())),
                AuthMode::ChatGPT => {
                    // Read tokens directly from auth.json to avoid non-Send futures
                    let auth_file = codex_home.join("auth.json");
                    if auth_file.exists() {
                        match std::fs::read_to_string(&auth_file) {
                            Ok(content) => {
                                match serde_json::from_str::<serde_json::Value>(&content) {
                                    Ok(json) => {
                                        if let Some(id_token) = json
                                            .get("tokens")
                                            .and_then(|t| t.get("id_token"))
                                            .and_then(|v| v.as_str())
                                        {
                                            match crate::auth::token_data::parse_id_token(id_token) {
                                                Ok(info) => {
                                                    let email = info
                                                        .email
                                                        .as_deref()
                                                        .unwrap_or("chatgpt")
                                                        .to_string();
                                                    let plan = info
                                                        .get_chatgpt_plan_type()
                                                        .unwrap_or_else(|| "unknown".to_string());
                                                    Ok(Some(format!("chatgpt:{}:{}", email, plan)))
                                                }
                                                Err(_) => Ok(Some("chatgpt:invalid".to_string())),
                                            }
                                        } else {
                                            Ok(Some("chatgpt:invalid".to_string()))
                                        }
                                    }
                                    Err(_) => Ok(Some("chatgpt:invalid".to_string())),
                                }
                            }
                            Err(_) => Ok(Some("chatgpt:invalid".to_string())),
                        }
                    } else {
                        Ok(Some("chatgpt:invalid".to_string()))
                    }
                }
            }
        }
        Ok(None) => Ok(None),
        Err(e) => Err(format!("Failed to read auth status: {}", e)),
    }
}

#[tauri::command]
pub async fn start_login_flow() -> Result<String, String> {
    let codex_home = dirs::home_dir()
        .ok_or("Could not find home directory")?
        .join(".codex");
    
    let opts = ServerOptions::new(codex_home, CLIENT_ID.to_string());
    
    match run_login_server(opts, None) {
        Ok(server) => {
            let auth_url = server.auth_url.clone();
            
            // Spawn a task to handle the server completion
            tokio::spawn(async move {
                if let Err(e) = server.block_until_done() {
                    log::error!("Login server error: {}", e);
                }
            });
            
            Ok(auth_url)
        }
        Err(e) => Err(format!("Failed to start login server: {}", e)),
    }
}

#[tauri::command]
pub async fn login_with_api_key_command(api_key: String) -> Result<(), String> {
    let codex_home = dirs::home_dir()
        .ok_or("Could not find home directory")?
        .join(".codex");
    
    login_with_api_key(&codex_home, &api_key)
        .map_err(|e| format!("Failed to save API key: {}", e))
}

#[tauri::command]
pub async fn logout_command() -> Result<bool, String> {
    let codex_home = dirs::home_dir()
        .ok_or("Could not find home directory")?
        .join(".codex");
    
    logout(&codex_home)
        .map_err(|e| format!("Failed to logout: {}", e))
}

#[tauri::command]
pub async fn get_auth_token() -> Result<Option<String>, String> {
    // 1) Environment variable takes precedence
    if let Ok(api_key) = std::env::var("OPENAI_API_KEY") {
        if !api_key.is_empty() {
            return Ok(Some(api_key));
        }
    }

    // 2) If an API key is stored in auth.json (CLI-compatible), return it
    let codex_home = dirs::home_dir()
        .ok_or("Could not find home directory")?
        .join(".codex");
    match load_auth(&codex_home, false).await {
        Ok(Some(auth)) => match auth.mode {
            AuthMode::ApiKey => Ok(auth.get_api_key()),
            AuthMode::ChatGPT => Ok(None),
        },
        _ => Ok(None),
    }
}
