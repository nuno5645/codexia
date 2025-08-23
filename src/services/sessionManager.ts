import { safeInvoke } from '@/utils/tauriMock';
import { CodexConfig } from '@/types/codex';
import { useFolderStore } from '@/stores/FolderStore';
import { tokenManager } from './tokenManager';

class SessionManager {
  private sessionConfigs: Map<string, CodexConfig> = new Map();
  private runningSessions: Set<string> = new Set();
  private readonly MAX_CONCURRENT_SESSIONS = 2; // Limit concurrent sessions

  async ensureSessionRunning(sessionId: string, config: CodexConfig): Promise<void> {
    // If session is already running, do nothing
    if (this.runningSessions.has(sessionId)) {
      return;
    }

    // If we're at the limit, stop the oldest session
    if (this.runningSessions.size >= this.MAX_CONCURRENT_SESSIONS) {
      const oldestSession = Array.from(this.runningSessions)[0];
      console.log(`Session limit reached (${this.MAX_CONCURRENT_SESSIONS}), stopping oldest session: ${oldestSession}`);
      await this.stopSession(oldestSession);
    }

    try {
      // Extract raw session ID for backend process management
      const rawSessionId = sessionId.startsWith('codex-event-') 
        ? sessionId.replace('codex-event-', '') 
        : sessionId;
      
      console.log(`🚀 Starting backend session: ${rawSessionId} (from frontend: ${sessionId})`);

      // Get current folder
      const currentFolder = useFolderStore.getState().currentFolder;
      
      console.log(`📁 currentFolder: ${currentFolder})`);

      // Get authentication token (OAuth or API key)
      const authToken = await tokenManager.getValidToken();
      
      console.log(`🔑 Auth token debug - Provider: ${config.provider}, Has token: ${!!authToken}, Length: ${authToken?.length || 0}`);

      // Start the session (backend will check if already exists)
      await safeInvoke('start_codex_session', {
        sessionId: rawSessionId,
        config: {
          working_directory: currentFolder,
          model: config.model,
          provider: config.provider,
          use_oss: config.useOss,
          custom_args: config.customArgs || null,
          approval_policy: config.approvalPolicy,
          sandbox_mode: config.sandboxMode,
          api_key: authToken, // This will be either OAuth token or API key
        },
      });

      this.runningSessions.add(sessionId);
      this.sessionConfigs.set(sessionId, config);
    } catch (error) {
      console.error('Failed to start session:', error);
      throw error;
    }
  }

  async stopSession(sessionId: string): Promise<void> {
    console.log(`🛑 SessionManager: Stopping session ${sessionId}`);
    
    // Extract raw session ID for backend process management
    const rawSessionId = sessionId.startsWith('codex-event-') 
      ? sessionId.replace('codex-event-', '') 
      : sessionId;
    
    console.log(`🔧 Stopping backend session: ${rawSessionId} (from frontend: ${sessionId})`);
    
    try {
      await safeInvoke('stop_session', { sessionId: rawSessionId });
    } catch (error) {
      console.error('Failed to stop session:', error);
      // Continue to clean up local state even if backend call fails
    }
    
    // Always clean up local state regardless of backend success/failure
    this.sessionConfigs.delete(sessionId);
    this.runningSessions.delete(sessionId);
    console.log(`✅ SessionManager: Session ${sessionId} removed from local state`);
    console.log(`📊 Remaining sessions:`, Array.from(this.runningSessions));
  }

  async closeSession(sessionId: string): Promise<void> {
    try {
      // Extract raw session ID for backend process management
      const rawSessionId = sessionId.startsWith('codex-event-') 
        ? sessionId.replace('codex-event-', '') 
        : sessionId;
      
      // Use the new close_session command which properly shuts down the protocol connection
      await safeInvoke('close_session', { sessionId: rawSessionId });
      this.sessionConfigs.delete(sessionId);
      this.runningSessions.delete(sessionId);
    } catch (error) {
      console.error('Failed to close session:', error);
      throw error;
    }
  }

  async restartSession(sessionId: string, config: CodexConfig): Promise<void> {
    try {
      console.log('Restarting session:', sessionId, 'with config:', config);
      
      // Stop the existing session
      if (this.runningSessions.has(sessionId)) {
        await this.stopSession(sessionId);
      }
      
      // Add a small delay to ensure cleanup is complete
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Start with new config
      await this.ensureSessionRunning(sessionId, config);
      
      console.log('Session restarted successfully:', sessionId);
    } catch (error) {
      console.error('Failed to restart session:', error);
      throw error;
    }
  }

  isSessionRunning(sessionId: string): boolean {
    return this.runningSessions.has(sessionId);
  }

  getLocalRunningSessions(): string[] {
    return Array.from(this.runningSessions);
  }
  
  async stopAllSessions(): Promise<void> {
    const sessions = Array.from(this.runningSessions);
    const promises = sessions.map(sessionId => 
      this.stopSession(sessionId).catch(error => {
        console.error(`Failed to stop session ${sessionId}:`, error);
        return null; // Don't let one failure stop the others
      })
    );
    
    await Promise.all(promises);
    console.log(`Stopped ${sessions.length} sessions`);
  }


  getSessionConfig(sessionId: string): CodexConfig | undefined {
    return this.sessionConfigs.get(sessionId);
  }

  // Update session ID mapping when the real session ID is discovered
  updateSessionId(oldSessionId: string, newSessionId: string): void {
    const config = this.sessionConfigs.get(oldSessionId);
    if (config) {
      // Remove old mapping
      this.sessionConfigs.delete(oldSessionId);
      this.runningSessions.delete(oldSessionId);
      
      // Add new mapping
      this.sessionConfigs.set(newSessionId, config);
      this.runningSessions.add(newSessionId);
      
      console.log(`Session ID updated from ${oldSessionId} to ${newSessionId}`);
    }
  }
}

export const sessionManager = new SessionManager();