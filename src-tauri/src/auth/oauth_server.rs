use std::io;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

use base64::{Engine, engine::general_purpose};
use tiny_http::{Header, Request, Response, Server};
use url::Url;

use crate::auth::pkce::{PkceCodes, generate_pkce};
use crate::auth::auth_storage::save_tokens;
use crate::auth::token_data::TokenData;

const DEFAULT_ISSUER: &str = "https://auth.openai.com";
const DEFAULT_PORT: u16 = 1455;

#[derive(Debug, Clone)]
pub struct ServerOptions {
    pub codex_home: PathBuf,
    pub client_id: String,
    pub issuer: String,
    pub port: u16,
    pub open_browser: bool,
    pub login_timeout: Option<Duration>,
}

impl ServerOptions {
    pub fn new(codex_home: PathBuf, client_id: String) -> Self {
        Self {
            codex_home,
            client_id,
            issuer: DEFAULT_ISSUER.to_string(),
            port: DEFAULT_PORT,
            open_browser: true,
            login_timeout: None,
        }
    }
}

pub struct LoginServer {
    pub auth_url: String,
    pub actual_port: u16,
    pub server_handle: thread::JoinHandle<io::Result<()>>,
    pub shutdown_flag: Arc<AtomicBool>,
    pub server: Arc<Server>,
}

impl LoginServer {
    pub fn block_until_done(self) -> io::Result<()> {
        self.server_handle
            .join()
            .map_err(|_| io::Error::new(io::ErrorKind::Other, "Failed to join server thread"))?
    }

    pub fn cancel(&self) {
        shutdown(&self.shutdown_flag, &self.server);
    }
}

#[derive(Clone)]
pub struct ShutdownHandle {
    shutdown_flag: Arc<AtomicBool>,
    server: Arc<Server>,
}

impl ShutdownHandle {
    pub fn cancel(&self) {
        shutdown(&self.shutdown_flag, &self.server);
    }
}

pub fn shutdown(shutdown_flag: &AtomicBool, server: &Server) {
    shutdown_flag.store(true, Ordering::SeqCst);
    server.unblock();
}

pub fn run_login_server(
    opts: ServerOptions,
    shutdown_flag: Option<Arc<AtomicBool>>,
) -> io::Result<LoginServer> {
    let server = Server::http(format!("127.0.0.1:{}", opts.port))
        .map_err(|e| io::Error::new(io::ErrorKind::AddrInUse, e))?;
    
    let actual_port = opts.port; // Use the configured port since tiny_http doesn't provide server_addr()
    let server = Arc::new(server);
    
    let shutdown_flag = shutdown_flag.unwrap_or_else(|| Arc::new(AtomicBool::new(false)));
    
    // Generate PKCE codes
    let pkce = generate_pkce();
    
    // Build OAuth authorization URL
    let redirect_uri = format!("http://127.0.0.1:{}/callback", actual_port);
    let state = generate_state();
    
    let mut auth_url = Url::parse(&format!("{}/authorize", opts.issuer))
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidInput, e))?;
    
    auth_url.query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", &opts.client_id)
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("scope", "openid email")
        .append_pair("state", &state)
        .append_pair("code_challenge", &pkce.code_challenge)
        .append_pair("code_challenge_method", "S256");
    
    let auth_url_string = auth_url.to_string();
    
    // Open browser if requested
    if opts.open_browser {
        if let Err(e) = webbrowser::open(&auth_url_string) {
            log::warn!("Failed to open browser: {}", e);
        }
    }
    
    // Clone data for the server thread
    let server_clone = server.clone();
    let shutdown_flag_clone = shutdown_flag.clone();
    let codex_home = opts.codex_home.clone();
    let client_id = opts.client_id.clone();
    let issuer = opts.issuer.clone();
    
    let server_handle = thread::spawn(move || -> io::Result<()> {
        for request in server_clone.incoming_requests() {
            if shutdown_flag_clone.load(Ordering::SeqCst) {
                break;
            }
            
            match handle_request(
                request,
                &pkce,
                &state,
                &codex_home,
                &client_id,
                &issuer,
                &redirect_uri,
            ) {
                Ok(should_continue) => {
                    if !should_continue {
                        break;
                    }
                }
                Err(e) => {
                    log::error!("Error handling request: {}", e);
                }
            }
        }
        Ok(())
    });
    
    Ok(LoginServer {
        auth_url: auth_url_string,
        actual_port,
        server_handle,
        shutdown_flag,
        server,
    })
}

fn handle_request(
    request: Request,
    pkce: &PkceCodes,
    expected_state: &str,
    codex_home: &PathBuf,
    client_id: &str,
    issuer: &str,
    redirect_uri: &str,
) -> io::Result<bool> {
    let url = request.url();
    
    if url.starts_with("/callback") {
        // Parse callback parameters
        let full_url = format!("http://localhost{}", url);
        let parsed_url = Url::parse(&full_url)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidInput, e))?;
        
        let mut code = None;
        let mut state = None;
        let mut error = None;
        
        for (key, value) in parsed_url.query_pairs() {
            match key.as_ref() {
                "code" => code = Some(value.to_string()),
                "state" => state = Some(value.to_string()),
                "error" => error = Some(value.to_string()),
                _ => {}
            }
        }
        
        // Handle OAuth error
        if let Some(error_msg) = error {
            let response_body = format!(
                "<html><body><h1>Authentication Failed</h1><p>Error: {}</p></body></html>",
                error_msg
            );
            let response = Response::from_string(response_body)
                .with_header(Header::from_bytes(&b"Content-Type"[..], &b"text/html"[..]).unwrap())
                .with_status_code(400);
            let _ = request.respond(response);
            return Ok(false);
        }
        
        // Validate state
        if state.as_deref() != Some(expected_state) {
            let response_body = "<html><body><h1>Authentication Failed</h1><p>Invalid state parameter</p></body></html>";
            let response = Response::from_string(response_body)
                .with_header(Header::from_bytes(&b"Content-Type"[..], &b"text/html"[..]).unwrap())
                .with_status_code(400);
            let _ = request.respond(response);
            return Ok(false);
        }
        
        // Exchange code for tokens
        if let Some(auth_code) = code {
            match exchange_code_for_tokens(auth_code, pkce, client_id, issuer, redirect_uri) {
                Ok(tokens) => {
                    // Save tokens to auth.json
                    if let Err(e) = save_tokens(codex_home, &tokens) {
                        log::error!("Failed to save tokens: {}", e);
                        let response_body = "<html><body><h1>Authentication Failed</h1><p>Failed to save tokens</p></body></html>";
                        let response = Response::from_string(response_body)
                            .with_header(Header::from_bytes(&b"Content-Type"[..], &b"text/html"[..]).unwrap())
                            .with_status_code(500);
                        let _ = request.respond(response);
                        return Ok(false);
                    }
                    
                    // Success response
                    let response_body = "<html><body><h1>Authentication Successful!</h1><p>You can now close this window and return to Codexia.</p></body></html>";
                    let response = Response::from_string(response_body)
                        .with_header(Header::from_bytes(&b"Content-Type"[..], &b"text/html"[..]).unwrap());
                    let _ = request.respond(response);
                    return Ok(false); // Stop server
                }
                Err(e) => {
                    log::error!("Failed to exchange code for tokens: {}", e);
                    let response_body = format!(
                        "<html><body><h1>Authentication Failed</h1><p>Error: {}</p></body></html>",
                        e
                    );
                    let response = Response::from_string(response_body)
                        .with_header(Header::from_bytes(&b"Content-Type"[..], &b"text/html"[..]).unwrap())
                        .with_status_code(500);
                    let _ = request.respond(response);
                    return Ok(false);
                }
            }
        }
    }
    
    // Default response for other paths
    let response_body = "<html><body><h1>Codexia Authentication</h1><p>Waiting for authentication...</p></body></html>";
    let response = Response::from_string(response_body)
        .with_header(Header::from_bytes(&b"Content-Type"[..], &b"text/html"[..]).unwrap());
    let _ = request.respond(response);
    
    Ok(true) // Continue server
}

fn exchange_code_for_tokens(
    code: String,
    pkce: &PkceCodes,
    client_id: &str,
    issuer: &str,
    redirect_uri: &str,
) -> Result<TokenData, Box<dyn std::error::Error>> {
    let token_url = format!("{}/token", issuer);
    
    let params = [
        ("grant_type", "authorization_code"),
        ("client_id", client_id),
        ("code", &code),
        ("redirect_uri", redirect_uri),
        ("code_verifier", &pkce.code_verifier),
    ];
    
    let client = reqwest::blocking::Client::new();
    let response = client
        .post(&token_url)
        .form(&params)
        .send()?;
    
    if !response.status().is_success() {
        let error_text = response.text().unwrap_or_else(|_| "Unknown error".to_string());
        return Err(format!("Token exchange failed: {}", error_text).into());
    }
    
    let token_response: serde_json::Value = response.json()?;
    
    let access_token = token_response
        .get("access_token")
        .and_then(|v| v.as_str())
        .ok_or("Missing access_token")?
        .to_string();
    
    let refresh_token = token_response
        .get("refresh_token")
        .and_then(|v| v.as_str())
        .ok_or("Missing refresh_token")?
        .to_string();
    
    let id_token_str = token_response
        .get("id_token")
        .and_then(|v| v.as_str())
        .ok_or("Missing id_token")?;
    
    let id_token = crate::auth::token_data::parse_id_token(id_token_str)?;
    
    Ok(TokenData {
        id_token,
        access_token,
        refresh_token,
        account_id: None,
    })
}

fn generate_state() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}