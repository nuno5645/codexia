use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fs::{File, OpenOptions, remove_file};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use crate::auth::token_data::{TokenData, AuthMode};
use crate::auth::OPENAI_API_KEY_ENV_VAR;

#[derive(Debug, Clone)]
pub struct CodexAuth {
    pub mode: AuthMode,
    api_key: Option<String>,
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
    pub fn get_api_key(&self) -> Option<String> {
        self.api_key.clone()
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
                }));
            }
        }
        
        // Check if we have OAuth tokens
        if let Some(_tokens) = &auth_json.tokens {
            return Ok(Some(CodexAuth {
                mode: AuthMode::ChatGPT,
                api_key: None,
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