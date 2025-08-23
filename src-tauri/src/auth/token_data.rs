use base64::Engine;
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Clone, Debug, PartialEq, Copy)]
pub enum AuthMode {
    ApiKey,
    ChatGPT,
}

#[derive(Deserialize, Serialize, Clone, Debug, PartialEq, Default)]
pub struct TokenData {
    /// Flat info parsed from the JWT in auth.json.
    #[serde(
        deserialize_with = "deserialize_id_token",
        serialize_with = "serialize_id_token"
    )]
    pub id_token: IdTokenInfo,

    /// This is a JWT.
    pub access_token: String,

    pub refresh_token: String,

    pub account_id: Option<String>,
}

impl TokenData {
    /// Returns true if this is a plan that should use the traditional
    /// "metered" billing via an API key.
    pub(crate) fn is_plan_that_should_use_api_key(&self) -> bool {
        self.id_token
            .chatgpt_plan_type
            .as_ref()
            .is_none_or(|plan| plan.is_plan_that_should_use_api_key())
    }
}

/// Flat subset of useful claims in id_token from auth.json.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct IdTokenInfo {
    pub email: Option<String>,
    /// The ChatGPT subscription plan type
    pub(crate) chatgpt_plan_type: Option<PlanType>,
    pub raw_jwt: String,
}

impl IdTokenInfo {
    pub fn get_chatgpt_plan_type(&self) -> Option<String> {
        self.chatgpt_plan_type.as_ref().map(|t| match t {
            PlanType::Known(plan) => format!("{plan:?}"),
            PlanType::Unknown(s) => s.clone(),
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum PlanType {
    Known(KnownPlan),
    Unknown(String),
}

impl PlanType {
    fn is_plan_that_should_use_api_key(&self) -> bool {
        match self {
            PlanType::Known(KnownPlan::Enterprise) => true,
            _ => false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum KnownPlan {
    Free,
    Plus,
    Pro,
    Business,
    Enterprise,
    Edu,
}

#[derive(Error, Debug)]
pub enum TokenError {
    #[error("Invalid JWT format")]
    InvalidJwt,
    #[error("Failed to decode base64: {0}")]
    Base64Error(#[from] base64::DecodeError),
    #[error("Failed to parse JSON: {0}")]
    JsonError(#[from] serde_json::Error),
}

pub fn parse_id_token(jwt: &str) -> Result<IdTokenInfo, TokenError> {
    let parts: Vec<&str> = jwt.split('.').collect();
    if parts.len() != 3 {
        return Err(TokenError::InvalidJwt);
    }

    // Decode the payload (second part)
    let payload_b64 = parts[1];
    let payload_bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload_b64)?;
    
    let payload: serde_json::Value = serde_json::from_slice(&payload_bytes)?;
    
    let email = payload
        .get("email")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    
    let chatgpt_plan_type = payload
        .get("https://api.openai.com/auth")
        .and_then(|auth| auth.get("chatgpt_plan_type"))
        .and_then(|v| v.as_str())
        .map(|s| match s {
            "free" => PlanType::Known(KnownPlan::Free),
            "plus" => PlanType::Known(KnownPlan::Plus),
            "pro" => PlanType::Known(KnownPlan::Pro),
            "business" => PlanType::Known(KnownPlan::Business),
            "enterprise" => PlanType::Known(KnownPlan::Enterprise),
            "edu" => PlanType::Known(KnownPlan::Edu),
            other => PlanType::Unknown(other.to_string()),
        });

    Ok(IdTokenInfo {
        email,
        chatgpt_plan_type,
        raw_jwt: jwt.to_string(),
    })
}

// Custom serialization/deserialization for IdTokenInfo
fn serialize_id_token<S>(token: &IdTokenInfo, serializer: S) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    serializer.serialize_str(&token.raw_jwt)
}

fn deserialize_id_token<'de, D>(deserializer: D) -> Result<IdTokenInfo, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let jwt = String::deserialize(deserializer)?;
    parse_id_token(&jwt).map_err(serde::de::Error::custom)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_valid_jwt() {
        // Create a minimal valid JWT for testing
        let header = serde_json::json!({"alg": "none", "typ": "JWT"});
        let payload = serde_json::json!({
            "email": "test@example.com",
            "https://api.openai.com/auth": {
                "chatgpt_plan_type": "plus"
            }
        });
        
        let header_b64 = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(serde_json::to_vec(&header).unwrap());
        let payload_b64 = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(serde_json::to_vec(&payload).unwrap());
        let signature_b64 = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(b"sig");
        
        let jwt = format!("{}.{}.{}", header_b64, payload_b64, signature_b64);
        
        let token_info = parse_id_token(&jwt).unwrap();
        assert_eq!(token_info.email, Some("test@example.com".to_string()));
        assert_eq!(token_info.chatgpt_plan_type, Some(PlanType::Known(KnownPlan::Plus)));
    }
}