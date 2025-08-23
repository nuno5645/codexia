mod auth;
mod codex_client;
mod commands;
mod config;
mod filesystem;
mod protocol;
mod services;
mod state;
mod utils;

use commands::{
    approve_execution, check_codex_version, close_session, delete_session_file,
    get_latest_session_id, get_running_sessions, get_session_files, read_session_file, read_history_file,
    load_sessions_from_disk, pause_session, send_message, send_message_with_media, start_codex_session, stop_session,
    // Authentication commands
    get_auth_status, start_login_flow, login_with_api_key_command, logout_command, get_auth_token,
};
use config::{
    add_mcp_server, add_or_update_model_provider, add_or_update_profile, delete_mcp_server,
    delete_profile, get_profile_config, get_project_name, get_provider_config, read_codex_config,
    read_mcp_servers, read_model_providers, read_profiles, update_profile_model,
};
use filesystem::{
    directory_ops::{get_default_directories, read_directory},
    file_analysis::calculate_file_tokens,
    file_io::{read_file, write_file},
    file_parsers::{csv::read_csv_content, pdf::read_pdf_content, xlsx::read_xlsx_content},
    git_diff::get_git_file_diff,
    git_status::get_git_status,
};
use state::CodexState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(if cfg!(debug_assertions) {
                    log::LevelFilter::Debug
                } else {
                    log::LevelFilter::Info
                })
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("logs".to_string()),
                    },
                ))
                .build()
        )
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(CodexState::new())
        .invoke_handler(tauri::generate_handler![
            start_codex_session,
            send_message,
            send_message_with_media,
            approve_execution,
            stop_session,
            pause_session,
            close_session,
            get_running_sessions,
            load_sessions_from_disk,
            delete_session_file,
            get_latest_session_id,
            get_session_files,
            read_session_file,
            read_history_file,
            check_codex_version,
            read_directory,
            get_default_directories,
            calculate_file_tokens,
            read_file,
            write_file,
            read_pdf_content,
            read_csv_content,
            read_xlsx_content,
            get_git_file_diff,
            get_git_status,
            read_codex_config,
            get_project_name,
            read_mcp_servers,
            add_mcp_server,
            delete_mcp_server,
            read_model_providers,
            read_profiles,
            get_provider_config,
            get_profile_config,
            update_profile_model,
            add_or_update_profile,
            delete_profile,
            add_or_update_model_provider,
            // Authentication commands
            get_auth_status,
            start_login_flow,
            login_with_api_key_command,
            logout_command,
            get_auth_token,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
