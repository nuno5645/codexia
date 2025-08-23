use base64::Engine;
use rand::RngCore;
use sha2::Digest;
use sha2::Sha256;

#[derive(Debug, Clone)]
pub struct PkceCodes {
    pub code_verifier: String,
    pub code_challenge: String,
}

pub fn generate_pkce() -> PkceCodes {
    let mut bytes = [0u8; 64];
    rand::thread_rng().fill_bytes(&mut bytes);

    // Verifier: URL-safe base64 without padding (43..128 chars)
    let code_verifier = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes);

    // Challenge (S256): BASE64URL-ENCODE(SHA256(verifier)) without padding
    let digest = Sha256::digest(code_verifier.as_bytes());
    let code_challenge = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(digest);

    PkceCodes {
        code_verifier,
        code_challenge,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pkce_generation() {
        let codes = generate_pkce();
        
        // Verify length constraints
        assert!(codes.code_verifier.len() >= 43);
        assert!(codes.code_verifier.len() <= 128);
        assert!(codes.code_challenge.len() >= 32); // SHA256 base64 encoded
        
        // Verify challenge is derived from verifier
        let digest = Sha256::digest(codes.code_verifier.as_bytes());
        let expected_challenge = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(digest);
        assert_eq!(codes.code_challenge, expected_challenge);
    }
}