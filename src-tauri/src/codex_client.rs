use anyhow::Result;
use chrono;
use serde_json;
use std::process::Stdio;
use std::collections::HashMap;
use tauri::{AppHandle, Emitter};
use tokio::fs::OpenOptions;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::config::{read_model_providers, read_profiles};
use crate::protocol::{CodexConfig, Event, InputItem, Op, Submission};

// Helper function to extract session_id from codex events
fn get_session_id_from_event(event: &Event) -> Option<String> {
    match &event.msg {
        crate::protocol::EventMsg::SessionConfigured { session_id, .. } => Some(session_id.clone()),
        _ => None,
    }
}
use crate::utils::codex_discovery::discover_codex_command;

pub struct CodexClient {
    #[allow(dead_code)]
    app: AppHandle,
    session_id: String,
    process: Option<Child>,
    stdin_tx: Option<mpsc::UnboundedSender<String>>,
    #[allow(dead_code)]
    config: CodexConfig,
}

impl CodexClient {
    pub async fn new(app: &AppHandle, session_id: String, config: CodexConfig) -> Result<Self> {
        log::debug!("Creating CodexClient for session and config: {} {:?}", session_id, config);

        // Build codex command based on configuration
        let (command, args): (String, Vec<String>) =
            if let Some(configured_path) = &config.codex_path {
                (configured_path.clone(), vec![])
            } else if let Some(path) = discover_codex_command() {
                (path.to_string_lossy().to_string(), vec![])
            } else {
                return Err(anyhow::anyhow!("Could not find codex executable"));
            };

        let mut cmd = Command::new(&command);
        if !args.is_empty() {
            cmd.args(&args);
        }
        cmd.arg("proto");
        
        // Set up environment variables for API keys
        let mut env_vars = HashMap::new();
        log::debug!("Config provider: {}, API key present: {}", 
                   config.provider, 
                   config.api_key.as_ref().map_or(false, |k| !k.is_empty()));
        
        if let Some(api_key) = &config.api_key {
            if !api_key.is_empty() {
                log::debug!("API key provided, length: {}", api_key.len());
                // Try to get the env_key from provider configuration first
                if let Ok(providers) = read_model_providers().await {
                    log::debug!("Successfully read providers, available: {:?}", providers.keys().collect::<Vec<_>>());
                    
                    // Try exact match first, then lowercase match
                    let provider_config = providers.get(&config.provider)
                        .or_else(|| providers.get(&config.provider.to_lowercase()));
                    
                    if let Some(provider_config) = provider_config {
                        log::debug!("Found provider config: {:?}", provider_config);
                        if !provider_config.env_key.is_empty() {
                            log::debug!("Setting env var {} from provider config", provider_config.env_key);
                            env_vars.insert(provider_config.env_key.clone(), api_key.clone());
                        } else {
                            log::debug!("Provider config has empty env_key");
                        }
                    } else {
                        log::debug!("Provider {} not found in config", config.provider);
                    }
                } else {
                    log::debug!("Failed to read providers, using fallback mapping");
                    // Fallback mapping if config reading fails
                    let env_var_name = match config.provider.as_str() {
                        "gemini" => "GEMINI_API_KEY",
                        "openai" => "OPENAI_API_KEY", 
                        "openrouter" => "OPENROUTER_API_KEY",
                        "ollama" => "OLLAMA_API_KEY",
                        _ => "OPENAI_API_KEY", // fallback
                    };
                    log::debug!("Using fallback env var: {}", env_var_name);
                    env_vars.insert(env_var_name.to_string(), api_key.clone());
                }
            } else {
                log::debug!("API key is empty");
            }
        } else {
            log::debug!("No API key provided");
        }

        // Load provider configuration from config.toml if provider is specified
        if !config.provider.is_empty() && config.provider != "openai" {
            if let Ok(providers) = read_model_providers().await {
                if let Ok(_profiles) = read_profiles().await {
                    // Check if there's a matching provider in config (try exact match first, then lowercase)
                    let provider_config = providers.get(&config.provider)
                        .or_else(|| providers.get(&config.provider.to_lowercase()));
                    
                    if let Some(provider_config) = provider_config {
                        // Set model provider based on config
                        cmd.arg("-c")
                            .arg(format!("model_provider={}", provider_config.name));

                        // Set base URL if available
                        if !provider_config.base_url.is_empty() {
                            cmd.arg("-c")
                                .arg(format!("base_url={}", provider_config.base_url));
                        }

                        // API key will be provided via environment variable - no need to modify provider config

                        // Always use model from config (user selection), not from profile
                        // This ensures user's model choice in the GUI takes precedence
                        if !config.model.is_empty() {
                            cmd.arg("-c").arg(format!("model={}", config.model));
                        }
                    } else {
                        // Fallback to original logic for custom providers
                        if config.use_oss {
                            cmd.arg("-c").arg("model_provider=oss");
                        } else {
                            cmd.arg("-c")
                                .arg(format!("model_provider={}", config.provider));
                        }

                        if !config.model.is_empty() {
                            cmd.arg("-c").arg(format!("model={}", config.model));
                        }

                        // API key will be provided via environment variable for custom providers
                    }
                }
            } else {
                // Fallback to original logic if config reading fails
                if config.use_oss {
                    cmd.arg("-c").arg("model_provider=oss");
                } else {
                    cmd.arg("-c")
                        .arg(format!("model_provider={}", config.provider));
                }

                if !config.model.is_empty() {
                    cmd.arg("-c").arg(format!("model={}", config.model));
                }

                // API key will be provided via environment variable
            }
        } else {
            // Original logic for OSS and default cases
            if config.use_oss {
                cmd.arg("-c").arg("model_provider=oss");
            }

            if !config.model.is_empty() {
                cmd.arg("-c").arg(format!("model={}", config.model));
            }

            // API key will be provided via environment variable for OpenAI
        }

        if !config.approval_policy.is_empty() {
            cmd.arg("-c")
                .arg(format!("approval_policy={}", config.approval_policy));
        }

        if !config.sandbox_mode.is_empty() {
            let sandbox_config = match config.sandbox_mode.as_str() {
                "read-only" => "sandbox_mode=read-only".to_string(),
                "workspace-write" => "sandbox_mode=workspace-write".to_string(),
                "danger-full-access" => "sandbox_mode=danger-full-access".to_string(),
                _ => "sandbox_mode=workspace-write".to_string(),
            };
            cmd.arg("-c").arg(sandbox_config);
        }

        // Enable streaming by setting show_raw_agent_reasoning=true
        // This is required for agent_message_delta events to be generated
        cmd.arg("-c").arg("show_raw_agent_reasoning=true");

        // Set working directory for the process
        if !config.working_directory.is_empty() {
            log::debug!("working_directory: {:?}", config.working_directory);
            cmd.arg("-c").arg(format!("cwd={}", config.working_directory));
        }

        // Add custom arguments
        if let Some(custom_args) = &config.custom_args {
            for arg in custom_args {
                cmd.arg(arg);
            }
        }

        // Print the command to be executed for debugging
        log::debug!("Starting codex with command: {:?}", cmd);

        // Apply environment variables to the command
        for (key, value) in &env_vars {
            log::debug!("Setting environment variable: {}=***", key);
            cmd.env(key, value);
        }

        let mut process = cmd
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .current_dir(&config.working_directory)
            .spawn()?;

        let stdin = process.stdin.take().expect("Failed to open stdin");
        let stdout = process.stdout.take().expect("Failed to open stdout");

        let (stdin_tx, mut stdin_rx) = mpsc::unbounded_channel::<String>();

        // Handle stdin writing
        let mut stdin_writer = stdin;
        tokio::spawn(async move {
            while let Some(line) = stdin_rx.recv().await {
                if let Err(e) = stdin_writer.write_all(line.as_bytes()).await {
                    log::error!("Failed to write to codex stdin: {}", e);
                    break;
                }
                if let Err(e) = stdin_writer.write_all(b"\n").await {
                    log::error!("Failed to write newline to codex stdin: {}", e);
                    break;
                }
                if let Err(e) = stdin_writer.flush().await {
                    log::error!("Failed to flush codex stdin: {}", e);
                    break;
                }
            }
            log::debug!("Stdin writer task terminated");
        });

        // Prepare debug event log file (JSONL) under ~/.codex/debug/
        let debug_log_path = match dirs::home_dir() {
            Some(home) => {
                let dir = home.join(".codex").join("debug");
                if let Err(e) = std::fs::create_dir_all(&dir) {
                    log::warn!("Failed to create debug log dir {}: {}", dir.display(), e);
                }
                let ts = chrono::Utc::now().format("%Y%m%d-%H%M%S");
                dir.join(format!("events-{}-{}.jsonl", ts, &session_id))
            }
            None => std::path::PathBuf::from(format!("events-{}.jsonl", &session_id)),
        };

        // Handle stdout reading
        let app_clone = app.clone();
        let session_id_clone = session_id.clone();
        let config_clone = config.clone();
        tokio::spawn(async move {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();
            let mut seq: u64 = 0;

            // Prepare CLI-style log file path
            let cli_log_path = match dirs::home_dir() {
                Some(home) => {
                    let log_dir = home.join(".codex").join("log");
                    if let Err(e) = std::fs::create_dir_all(&log_dir) {
                        log::warn!("Failed to create CLI log dir {}: {}", log_dir.display(), e);
                    }
                    log_dir.join("codex-tui.log")
                }
                None => std::path::PathBuf::from("codex-tui.log"),
            };

            // Open debug log file in append mode
            let mut log_file = match OpenOptions::new().create(true).append(true).open(&debug_log_path).await {
                Ok(f) => Some(f),
                Err(e) => {
                    log::warn!("Could not open debug event log {}: {}", debug_log_path.display(), e);
                    None
                }
            };

            // Open CLI-style log file in append mode
            let mut cli_log_file = match OpenOptions::new().create(true).append(true).open(&cli_log_path).await {
                Ok(f) => Some(f),
                Err(e) => {
                    log::warn!("Could not open CLI log file {}: {}", cli_log_path.display(), e);
                    None
                }
            };

        log::debug!("Starting stdout reader for session: {}", session_id_clone);

        // Log comprehensive session startup in CLI style
        if let Some(cli_f) = cli_log_file.as_mut() {
            let timestamp = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.6fZ");
            let startup_entries = vec![
                format!("{}  INFO Starting Codex session\n", timestamp),
                format!("{}  INFO Provider: {} | Model: {} | Session: {}\n", 
                    timestamp, config_clone.provider, config_clone.model, session_id_clone),
                format!("{}  INFO Working directory: {}\n", 
                    timestamp, config_clone.working_directory),
                format!("{}  INFO Approval policy: {} | Sandbox: {}\n", 
                    timestamp, config_clone.approval_policy, config_clone.sandbox_mode),
            ];
            for entry in startup_entries {
                let _ = cli_f.write_all(entry.as_bytes()).await;
            }
            let _ = cli_f.flush().await;
        }

            while let Ok(Some(line)) = lines.next_line().await {
                // log::debug!("📥 Received line from codex: {}", line);
                let parsed = serde_json::from_str::<Event>(&line);

                // Write debug record to file
                if let Some(f) = log_file.as_mut() {
                    let ts = chrono::Utc::now().to_rfc3339();
                    let record = match &parsed {
                        Ok(ev) => serde_json::json!({
                            "ts": ts,
                            "seq": seq,
                            "session_id": session_id_clone,
                            "ok": true,
                            "event": ev,
                        }),
                        Err(_e) => serde_json::json!({
                            "ts": ts,
                            "seq": seq,
                            "session_id": session_id_clone,
                            "ok": false,
                            "raw": line,
                        }),
                    };
                    let _ = f.write_all(serde_json::to_string(&record).unwrap_or_default().as_bytes()).await;
                    let _ = f.write_all(b"\n").await;
                }

                seq = seq.saturating_add(1);

                if let Ok(event) = parsed {
                    // Write comprehensive CLI-style log entries to capture all agent activity
                    if let Some(cli_f) = cli_log_file.as_mut() {
                        let timestamp = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.6fZ");
                        let cli_entry = match &event.msg {
                            crate::protocol::EventMsg::ExecApprovalRequest { command, cwd } => {
                                Some(format!(
                                    "{}  INFO FunctionCall: {{\"command\":\"{}\", \"cwd\": \"{}\", \"timeout\": 120000}}\n",
                                    timestamp,
                                    command,
                                    cwd
                                ))
                            },
                            crate::protocol::EventMsg::Error { message } => {
                                Some(format!("{}  INFO Turn error: {}\n", timestamp, message))
                            },
                            crate::protocol::EventMsg::SessionConfigured { session_id, model, .. } => {
                                Some(format!("{}  INFO Session configured: {} with model {}\n", timestamp, session_id, model))
                            },
                            crate::protocol::EventMsg::TurnComplete { .. } => {
                                Some(format!("{}  INFO Turn completed\n", timestamp))
                            },
                            crate::protocol::EventMsg::TurnAborted => {
                                Some(format!("{}  INFO Aborting existing session\n", timestamp))
                            },
                            crate::protocol::EventMsg::ShutdownComplete => {
                                Some(format!("{}  INFO Shutting down Codex instance\n", timestamp))
                            },
                            // Capture agent reasoning and thinking process
                            crate::protocol::EventMsg::AgentMessageDelta { delta } => {
                                if !delta.trim().is_empty() {
                                    // Clean and format agent reasoning for CLI-style logs
                                    let clean_delta = delta.replace('\n', " ").replace('\r', "");
                                    Some(format!("{}  INFO Agent reasoning: {}\n", timestamp, clean_delta))
                                } else {
                                    None
                                }
                            },
                            // Capture agent reasoning stream events for better logging
                            crate::protocol::EventMsg::AgentReasoningDelta { delta } => {
                                if !delta.trim().is_empty() {
                                    let clean_delta = delta.replace('\n', " ").replace('\r', "");
                                    Some(format!("{}  INFO Agent reasoning delta: {}\n", timestamp, clean_delta))
                                } else {
                                    None
                                }
                            },
                            crate::protocol::EventMsg::AgentReasoning { text } => {
                                let clean_text = text.replace('\n', " ").replace('\r', "");
                                Some(format!("{}  INFO Agent reasoning complete: {}\n", timestamp, clean_text))
                            },
                            // Capture any agent messages
                            crate::protocol::EventMsg::AgentMessage { message, .. } => {
                                if let Some(content) = message {
                                    let clean_content = content.replace('\n', " ").replace('\r', "");
                                    Some(format!("{}  INFO Agent message: {}\n", timestamp, clean_content))
                                } else {
                                    None
                                }
                            },
                            // Log execution command start
                            crate::protocol::EventMsg::ExecCommandBegin { call_id, command, cwd } => {
                                let cmd_str = command.join(" ");
                                Some(format!("{}  INFO ExecCommandBegin: call_id={}, command=\"{}\", cwd=\"{}\"\n", 
                                    timestamp, call_id, cmd_str, cwd))
                            },
                            // Log execution results with brief summary
                            crate::protocol::EventMsg::ExecCommandEnd { call_id, exit_code, stdout, stderr } => {
                                let stdout_preview = stdout.chars().take(200).collect::<String>();
                                let stderr_preview = stderr.chars().take(200).collect::<String>();
                                Some(format!("{}  INFO ExecCommandEnd: call_id={}, exit_code={}, stdout_preview=\"{}\", stderr_preview=\"{}\"\n", 
                                    timestamp, call_id, exit_code, stdout_preview, stderr_preview))
                            },
                            // Log execution output deltas for real-time command output
                            crate::protocol::EventMsg::ExecCommandOutputDelta { call_id, stream, chunk } => {
                                let chunk_str = String::from_utf8_lossy(chunk);
                                let clean_chunk = chunk_str.replace('\n', " ").replace('\r', "");
                                if !clean_chunk.trim().is_empty() {
                                    Some(format!("{}  INFO ExecOutput[{}]: {} - {}\n", timestamp, call_id, stream, clean_chunk))
                                } else {
                                    None
                                }
                            },
                            // Log plan updates to show agent's planning process
                            crate::protocol::EventMsg::PlanUpdate { plan } => {
                                let plan_summary = plan.iter()
                                    .map(|item| format!("{}: {}", item.step, item.status))
                                    .collect::<Vec<_>>()
                                    .join(", ");
                                Some(format!("{}  INFO Plan update: {}\n", timestamp, plan_summary))
                            },
                            // Log patch operations
                            crate::protocol::EventMsg::PatchApprovalRequest { files, .. } => {
                                Some(format!("{}  INFO Patch approval requested for files: {:?}\n", timestamp, files))
                            },
                            crate::protocol::EventMsg::PatchApplyBegin => {
                                Some(format!("{}  INFO Patch apply begin\n", timestamp))
                            },
                            crate::protocol::EventMsg::PatchApplyEnd { success } => {
                                Some(format!("{}  INFO Patch apply end: success={}\n", timestamp, success))
                            },
                            // Catch any other significant events
                            _ => {
                                // For debugging, log all other event types with limited detail
                                let event_type = match &event.msg {
                                    crate::protocol::EventMsg::TurnStarted => Some("TurnStarted"),
                                    crate::protocol::EventMsg::TaskStarted => Some("TaskStarted"),
                                    crate::protocol::EventMsg::TaskComplete { .. } => Some("TaskComplete"),
                                    crate::protocol::EventMsg::TurnDiff { .. } => Some("TurnDiff"),
                                    crate::protocol::EventMsg::TokenCount { .. } => Some("TokenCount"),
                                    crate::protocol::EventMsg::TokenCountUpdate { .. } => Some("TokenCountUpdate"),
                                    crate::protocol::EventMsg::AgentReasoningSectionBreak => Some("AgentReasoningSectionBreak"),
                                    crate::protocol::EventMsg::BackgroundEvent { .. } => Some("BackgroundEvent"),
                                    _ => None,
                                };
                                if let Some(evt_type) = event_type {
                                    Some(format!("{}  INFO Event: {}\n", timestamp, evt_type))
                                } else {
                                    None
                                }
                            },
                        };
                        
                        if let Some(entry) = cli_entry {
                            let _ = cli_f.write_all(entry.as_bytes()).await;
                            let _ = cli_f.flush().await;
                        }
                    }
                    // log::debug!("📨 Parsed event: {:?}", event);

                    // Log the event for debugging
                    if let Some(event_session_id) = get_session_id_from_event(&event) {
                        log::debug!("Event for session: {}", event_session_id);
                    }

                    // Use a single global event channel instead of per-session channels
                    if let Err(e) = app_clone.emit("codex-events", &event) {
                        log::error!("Failed to emit event: {}", e);
                    }
                } else {
                    log::warn!("Failed to parse codex event: {}", line);
                }
            }
            log::debug!("Stdout reader terminated for session: {}", session_id_clone);
        });

        let client = Self {
            app: app.clone(),
            session_id,
            process: Some(process),
            stdin_tx: Some(stdin_tx),
            config: config.clone(),
        };

        Ok(client)
    }

    async fn log_to_cli_file(&self, message: &str) {
        if let Some(home) = dirs::home_dir() {
            let log_path = home.join(".codex").join("log").join("codex-tui.log");
            if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&log_path).await {
                let timestamp = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.6fZ");
                let entry = format!("{}  INFO {}\n", timestamp, message);
                let _ = file.write_all(entry.as_bytes()).await;
            }
        }
    }

    async fn send_submission(&self, submission: Submission) -> Result<()> {
        if let Some(stdin_tx) = &self.stdin_tx {
            let json = serde_json::to_string(&submission)?;
            log::debug!("📤 Sending JSON to codex: {}", json);
            stdin_tx.send(json)?;
        }
        Ok(())
    }

    pub async fn send_user_input(&self, message: String) -> Result<()> {
        // Log user input in CLI style with more detail
        let preview = if message.len() > 100 {
            format!("{}...", message.chars().take(100).collect::<String>())
        } else {
            message.clone()
        };
        self.log_to_cli_file(&format!("User input received: {}", preview)).await;
        
        let submission = Submission {
            id: Uuid::new_v4().to_string(),
            op: Op::UserInput {
                items: vec![InputItem::Text { text: message }],
            },
        };

        self.send_submission(submission).await
    }

    pub async fn send_user_input_with_media(&self, message: String, media_paths: Vec<String>) -> Result<()> {
        log::debug!("🎯 [CodexClient] send_user_input_with_media called:");
        log::debug!("  💬 message: {}", message);
        log::debug!("  📸 media_paths: {:?}", media_paths);
        log::debug!("  📊 media_paths count: {}", media_paths.len());
        
        // Log user input with media in CLI style with more detail
        let preview = if message.len() > 100 {
            format!("{}...", message.chars().take(100).collect::<String>())
        } else {
            message.clone()
        };
        self.log_to_cli_file(&format!("User input with {} media file(s): {}", 
            media_paths.len(), preview
        )).await;
        for (i, path) in media_paths.iter().enumerate() {
            self.log_to_cli_file(&format!("  Media file {}: {}", i + 1, path)).await;
        }
        
        let mut items = vec![InputItem::Text { text: message }];
        
        // Add media files as LocalImage items - codex will convert to base64 automatically
        for path in media_paths {
            let path_buf = std::path::PathBuf::from(path.clone());
            log::debug!("  🔗 Adding local image path: {}", path);
            items.push(InputItem::LocalImage { path: path_buf });
        }
        
        log::debug!("  📦 Total items in submission: {}", items.len());
        
        let submission = Submission {
            id: Uuid::new_v4().to_string(),
            op: Op::UserInput { items },
        };
        
        log::debug!("  🚀 Sending submission to codex");
        self.send_submission(submission).await
    }

    pub async fn send_exec_approval(&self, approval_id: String, approved: bool) -> Result<()> {
        let decision = if approved { "allow" } else { "deny" }.to_string();

        let submission = Submission {
            id: Uuid::new_v4().to_string(),
            op: Op::ExecApproval {
                id: approval_id,
                decision,
            },
        };

        self.send_submission(submission).await
    }

    #[allow(dead_code)]
    pub async fn send_patch_approval(&self, approval_id: String, approved: bool) -> Result<()> {
        let decision = if approved { "allow" } else { "deny" }.to_string();

        let submission = Submission {
            id: Uuid::new_v4().to_string(),
            op: Op::PatchApproval {
                id: approval_id,
                decision,
            },
        };

        self.send_submission(submission).await
    }

    pub async fn interrupt(&self) -> Result<()> {
        let submission = Submission {
            id: Uuid::new_v4().to_string(),
            op: Op::Interrupt,
        };

        self.send_submission(submission).await
    }

    pub async fn close_session(&mut self) -> Result<()> {
        log::debug!("Closing session: {}", self.session_id);
        
        // Log shutdown in CLI style
        self.log_to_cli_file("Shutting down Codex instance").await;

        // Send shutdown command to codex (graceful shutdown)
        let submission = Submission {
            id: Uuid::new_v4().to_string(),
            op: Op::Shutdown,
        };

        if let Err(e) = self.send_submission(submission).await {
            log::error!("Failed to send shutdown command: {}", e);
        }

        // Close stdin channel to signal end of input
        if let Some(stdin_tx) = self.stdin_tx.take() {
            drop(stdin_tx);
            log::debug!("Stdin channel closed");
        }

        // Wait a moment for graceful shutdown, then terminate process if needed
        if let Some(mut process) = self.process.take() {
            if let Some(pid) = process.id() {
                log::debug!("Terminating codex process with PID: {}", pid);
            }

            // Give the process a moment to shutdown gracefully
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

            // Check if process is still running, then kill if necessary
            match process.try_wait() {
                Ok(Some(status)) => {
                    log::debug!("Codex process exited with status: {}", status);
                }
                Ok(None) => {
                    // Process still running, kill it
                    log::debug!("Process still running, terminating...");
                    if let Err(e) = process.kill().await {
                        log::error!("Failed to kill codex process: {}", e);
                    } else {
                        log::debug!("Codex process terminated successfully");
                    }
                }
                Err(e) => {
                    log::error!("Error checking process status: {}", e);
                    // Try to kill anyway
                    if let Err(e) = process.kill().await {
                        log::error!("Failed to kill codex process: {}", e);
                    }
                }
            }
        }

        log::debug!("Session {} closed", self.session_id);
        Ok(())
    }
    
    #[allow(dead_code)]
    pub async fn shutdown(&mut self) -> Result<()> {
        self.close_session().await
    }

    #[allow(dead_code)]
    pub fn is_active(&self) -> bool {
        self.process.is_some() && self.stdin_tx.is_some()
    }
}
