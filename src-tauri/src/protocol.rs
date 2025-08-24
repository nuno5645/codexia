use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Submission {
    pub id: String,
    pub op: Op,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Op {
    ConfigureSession {
        provider: ModelProvider,
        model: String,
        model_reasoning_effort: String,
        model_reasoning_summary: String,
        user_instructions: Option<String>,
        base_instructions: Option<String>,
        approval_policy: String,
        sandbox_policy: SandboxPolicy,
        disable_response_storage: bool,
        cwd: PathBuf,
        resume_path: Option<PathBuf>,
    },
    UserInput {
        items: Vec<InputItem>,
    },
    Interrupt,
    ExecApproval {
        id: String,
        decision: String,
    },
    PatchApproval {
        id: String,
        decision: String,
    },
    Shutdown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelProvider {
    pub name: String,
    pub base_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "kebab-case")]
pub enum SandboxPolicy {
    #[serde(rename = "read-only")]
    ReadOnly,
    #[serde(rename = "workspace-write")]
    WorkspaceWrite {
        #[serde(default)]
        writable_roots: Vec<PathBuf>,
        #[serde(default)]
        network_access: bool,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum InputItem {
    Text { text: String },
    /// Pre‑encoded data: URI image.
    Image { image_url: String },
    /// Local image path provided by the user. This will be converted to an
    /// `Image` variant (base64 data URL) during request serialization.
    LocalImage { path: std::path::PathBuf },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Event {
    pub id: String,
    pub msg: EventMsg,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum EventMsg {
    SessionConfigured {
        session_id: String,
        model: String,
        history_log_id: Option<u32>,
        history_entry_count: Option<u32>,
    },
    TaskStarted,
    TaskComplete {
        response_id: Option<String>,
        last_agent_message: Option<String>,
    },
    AgentMessage {
        message: Option<String>,
        last_agent_message: Option<String>,
    },
    AgentMessageDelta {
        delta: String,
    },
    // Newer CLI event types for reasoning stream and metrics
    #[serde(rename = "agent_reasoning_delta")]
    AgentReasoningDelta {
        delta: String,
    },
    #[serde(rename = "agent_reasoning")]
    AgentReasoning {
        text: String,
    },
    #[serde(rename = "agent_reasoning_raw_content_delta")]
    AgentReasoningRawContentDelta {
        delta: String,
    },
    #[serde(rename = "agent_reasoning_raw_content")]
    AgentReasoningRawContent {
        text: String,
    },
    #[serde(rename = "agent_reasoning_section_break")]
    AgentReasoningSectionBreak,
    #[serde(rename = "token_count")]
    TokenCount {
        input_tokens: u32,
        cached_input_tokens: u32,
        output_tokens: u32,
        reasoning_output_tokens: u32,
        total_tokens: u32,
    },
    #[serde(rename = "token_count_update")]
    TokenCountUpdate {
        #[serde(default)]
        input_tokens: Option<u32>,
        #[serde(default)]
        cached_input_tokens: Option<u32>,
        #[serde(default)]
        output_tokens: Option<u32>,
        #[serde(default)]
        reasoning_output_tokens: Option<u32>,
        #[serde(default)]
        total_tokens: Option<u32>,
    },
    #[serde(rename = "turn_started")]
    TurnStarted,
    #[serde(rename = "turn_aborted")]
    TurnAborted,
    #[serde(rename = "plan_update")]
    PlanUpdate {
        plan: Vec<PlanItem>,
    },
    #[serde(rename = "turn_diff")]
    TurnDiff {
        unified_diff: String,
    },
    #[serde(rename = "patch_apply_begin")]
    PatchApplyBegin,
    #[serde(rename = "patch_apply_end")]
    PatchApplyEnd {
        success: bool,
    },
    ExecApprovalRequest {
        command: String,
        cwd: String,
    },
    PatchApprovalRequest {
        patch: String,
        files: Vec<String>,
    },
    Error {
        message: String,
    },
    TurnComplete {
        response_id: Option<String>,
    },
    ExecCommandBegin {
        call_id: String,
        command: Vec<String>,
        cwd: String,
    },
    ExecCommandOutputDelta {
        call_id: String,
        stream: String,
        chunk: Vec<u8>,
    },
    ExecCommandEnd {
        call_id: String,
        stdout: String,
        stderr: String,
        exit_code: i32,
    },
    ShutdownComplete,
    BackgroundEvent {
        message: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanItem {
    pub step: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodexConfig {
    pub working_directory: String,
    pub model: String,
    pub provider: String,
    pub use_oss: bool,
    pub custom_args: Option<Vec<String>>,
    pub approval_policy: String,
    pub sandbox_mode: String,
    pub codex_path: Option<String>,
    pub api_key: Option<String>,
}
