use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fs::{File, OpenOptions, remove_file};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use crate::auth::token_data::{TokenData, AuthMode};
use crate::auth::OPENAI_API_KEY_ENV_VAR;

#[derive(Debug, Clone)]
pub struct CodexAuth {
    pub mode: AuthMode,
    api_key: Option<String>,
    auth_dot_json: Arc<Mutex<Option<AuthDotJson>>>,
    auth_file: PathBuf,
}

impl PartialEq for CodexAuth {
    fn eq(&self, other: &Self) -> bool {
        self.mode == other.mode && self.api_key == other.api_key
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
struct AuthDotJson {
    #[serde(rename = "OPENAI_API_KEY")]
    openai_api_key: Option<String>,
    tokens: Option<TokenData>,
    last_refresh: Option<DateTime<Utc>>,
}

impl CodexAuth {
    pub async fn get_token_data(&self) -> Result<TokenData, Box<dyn std::error::Error + Send + Sync>> {
        match self.mode {
            AuthMode::ApiKey => {
                Err("API key mode does not have token data".into())
            }
            AuthMode::ChatGPT => {
                let guard = self.auth_dot_json.lock().map_err(|_| "Failed to lock auth data")?;
                if let Some(auth_json) = guard.as_ref() {
                    if let Some(tokens) = &auth_json.tokens {
                        // Check if token needs refresh
                        if let Some(last_refresh) = auth_json.last_refresh {
                            let now = Utc::now();
                            let elapsed = now.signed_duration_since(last_refresh);
                            
                            // Refresh if older than 50 minutes (tokens expire in 1 hour)
                            if elapsed > chrono::Duration::minutes(50) {
                                drop(guard); // Release the lock before refreshing
                                return self.refresh_token().await;
                            }
                        }
                        
                        Ok(tokens.clone())
                    } else {
                        Err("No tokens available".into())
                    }
                } else {
                    Err("No authentication data available".into())
                }
            }
        }
    }

    pub fn get_api_key(&self) -> Option<String> {
        self.api_key.clone()
    }

    async fn refresh_token(&self) -> Result<TokenData, Box<dyn std::error::Error + Send + Sync>> {
        let refresh_token = {
            let guard = self.auth_dot_json.lock().map_err(|_| "Failed to lock auth data")?;
            if let Some(auth_json) = guard.as_ref() {
                if let Some(tokens) = &auth_json.tokens {
                    tokens.refresh_token.clone()
                } else {
                    return Err("No tokens available for refresh".into());
                }
            } else {
                return Err("No authentication data available".into());
            }
        };

        // Make refresh request
        let client = reqwest::Client::new();
        let response = client
            .post("https://auth.openai.com/token")
            .form(&[
                ("grant_type", "refresh_token"),
                ("refresh_token", &refresh_token),
            ])
            .send()
            .await?;

        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
            return Err(format!("Token refresh failed: {}", error_text).into());
        }

        let token_response: serde_json::Value = response.json().await?;
        
        let access_token = token_response
            .get("access_token")
            .and_then(|v| v.as_str())
            .ok_or("Missing access_token")?
            .to_string();
        
        let new_refresh_token = token_response
            .get("refresh_token")
            .and_then(|v| v.as_str())
            .unwrap_or(&refresh_token) // Use old refresh token if new one not provided
            .to_string();
        
        let id_token_str = token_response
            .get("id_token")
            .and_then(|v| v.as_str())
            .ok_or("Missing id_token")?;
        
        let id_token = crate::auth::token_data::parse_id_token(id_token_str)?;
        
        let new_tokens = TokenData {
            id_token,
            access_token,
            refresh_token: new_refresh_token,
            account_id: None,
        };

        // Update stored tokens
        {
            let mut guard = self.auth_dot_json.lock().map_err(|_| "Failed to lock auth data")?;
            if let Some(auth_json) = guard.as_mut() {
                auth_json.tokens = Some(new_tokens.clone());
                auth_json.last_refresh = Some(Utc::now());
                
                // Save to file
                if let Err(e) = save_auth_to_file(&self.auth_file, auth_json) {
                    return Err(format!("Failed to save tokens: {}", e).into());
                }
            }
        }

        Ok(new_tokens)
    }
}

pub fn get_auth_file(codex_home: &Path) -> PathBuf {
    codex_home.join("auth.json")
}

pub async fn load_auth(codex_home: &Path, _require_valid: bool) -> Result<Option<CodexAuth>, Box<dyn std::error::Error + Send + Sync>> {
    let auth_file = get_auth_file(codex_home);
    
    // Check for environment variable first
    if let Ok(api_key) = std::env::var(OPENAI_API_KEY_ENV_VAR) {
        if !api_key.is_empty() {
            return Ok(Some(CodexAuth {
                mode: AuthMode::ApiKey,
                api_key: Some(api_key),
                auth_dot_json: Arc::new(Mutex::new(None)),
                auth_file,
            }));
        }
    }
    
    // Try to load from auth.json
    if auth_file.exists() {
        let mut file = File::open(&auth_file)?;
        let mut contents = String::new();
        file.read_to_string(&mut contents)?;
        
        let auth_json: AuthDotJson = serde_json::from_str(&contents)?;
        
        // Check if we have an API key in the file
        if let Some(api_key) = &auth_json.openai_api_key {
            if !api_key.is_empty() {
                // Determine mode based on plan type
                let mode = if let Some(tokens) = &auth_json.tokens {
                    if tokens.is_plan_that_should_use_api_key() {
                        AuthMode::ApiKey
                    } else {
                        AuthMode::ChatGPT
                    }
                } else {
                    AuthMode::ApiKey
                };
                
                return Ok(Some(CodexAuth {
                    mode,
                    api_key: Some(api_key.clone()),
                    auth_dot_json: Arc::new(Mutex::new(if mode == AuthMode::ChatGPT { 
                        Some(auth_json) 
                    } else { 
                        None 
                    })),
                    auth_file,
                }));
            }
        }
        
        // Check if we have OAuth tokens
        if let Some(_tokens) = &auth_json.tokens {
            return Ok(Some(CodexAuth {
                mode: AuthMode::ChatGPT,
                api_key: None,
                auth_dot_json: Arc::new(Mutex::new(Some(auth_json))),
                auth_file,
            }));
        }
    }
    
    Ok(None)
}

pub fn login_with_api_key(codex_home: &Path, api_key: &str) -> Result<(), Box<dyn std::error::Error>> {
    let auth_file = get_auth_file(codex_home);
    
    let auth_json = AuthDotJson {
        openai_api_key: Some(api_key.to_string()),
        tokens: None,
        last_refresh: None,
    };
    
    save_auth_to_file(&auth_file, &auth_json)?;
    Ok(())
}

pub fn save_tokens(codex_home: &Path, tokens: &TokenData) -> Result<(), Box<dyn std::error::Error>> {
    let auth_file = get_auth_file(codex_home);
    
    // Load existing auth data or create new
    let mut auth_json = if auth_file.exists() {
        let mut file = File::open(&auth_file)?;
        let mut contents = String::new();
        file.read_to_string(&mut contents)?;
        serde_json::from_str(&contents).unwrap_or_else(|_| AuthDotJson {
            openai_api_key: None,
            tokens: None,
            last_refresh: None,
        })
    } else {
        AuthDotJson {
            openai_api_key: None,
            tokens: None,
            last_refresh: None,
        }
    };
    
    auth_json.tokens = Some(tokens.clone());
    auth_json.last_refresh = Some(Utc::now());
    
    save_auth_to_file(&auth_file, &auth_json)?;
    Ok(())
}

pub fn logout(codex_home: &Path) -> Result<bool, std::io::Error> {
    let auth_file = get_auth_file(codex_home);
    
    if auth_file.exists() {
        remove_file(auth_file)?;
        Ok(true)
    } else {
        Ok(false)
    }
}

fn save_auth_to_file(auth_file: &Path, auth_json: &AuthDotJson) -> Result<(), Box<dyn std::error::Error>> {
    // Create directory if it doesn't exist
    if let Some(parent) = auth_file.parent() {
        std::fs::create_dir_all(parent)?;
    }
    
    // Set proper permissions (readable only by owner)
    let mut file = OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(auth_file)?;
    
    #[cfg(unix)]
    {
        use std::os::unix::fs::{PermissionsExt, OpenOptionsExt};
        let mut opts = OpenOptions::new();
        opts.mode(0o600); // Read/write for owner only
        if auth_file.exists() {
            std::fs::set_permissions(auth_file, std::fs::Permissions::from_mode(0o600))?;
        }
    }
    
    let json_string = serde_json::to_string_pretty(auth_json)?;
    file.write_all(json_string.as_bytes())?;
    file.flush()?;
    
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_api_key_login() {
        let dir = tempdir().unwrap();
        let result = login_with_api_key(dir.path(), "sk-test-key");
        assert!(result.is_ok());
        
        let auth_file = get_auth_file(dir.path());
        assert!(auth_file.exists());
        
        let mut file = File::open(auth_file).unwrap();
        let mut contents = String::new();
        file.read_to_string(&mut contents).unwrap();
        
        let auth_json: AuthDotJson = serde_json::from_str(&contents).unwrap();
        assert_eq!(auth_json.openai_api_key, Some("sk-test-key".to_string()));
    }

    #[test]
    fn test_logout() {
        let dir = tempdir().unwrap();
        login_with_api_key(dir.path(), "sk-test-key").unwrap();
        
        let removed = logout(dir.path()).unwrap();
        assert!(removed);
        
        let auth_file = get_auth_file(dir.path());
        assert!(!auth_file.exists());
    }
}