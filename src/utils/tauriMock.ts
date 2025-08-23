// Tauri API wrapper for consistent invoke behavior

// Extend Window interface to include Tauri properties
declare global {
  interface Window {
    __TAURI__?: any;
    __TAURI_INTERNALS__?: any;
    __TAURI_METADATA__?: any;
  }
}

// Helper to check if we're in Tauri context (robust across Tauri v1/v2)
export const isTauriContext = () => {
  if (typeof window === 'undefined') return false;
  const w = window as any;
  if (w.__TAURI__ || w.__TAURI_INTERNALS__ || w.__TAURI_METADATA__) return true;
  // Many Tauri builds add a UA marker
  try {
    const ua = navigator.userAgent || '';
    if (ua.includes('Tauri')) return true;
  } catch {}
  return false;
};

// Create a wrapper that tries invoke; if unavailable, surface a clear message
export const safeInvoke = async (command: string, payload?: any) => {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke(command, payload);
  } catch (error: any) {
    // Normalize the error for callers
    const message = error?.message || String(error);
    throw new Error(
      message?.includes('IPC') || message?.includes('tauri') || !isTauriContext()
        ? `Tauri command "${command}" called outside Tauri context. Run 'bun tauri dev' for full functionality.`
        : message
    );
  }
};

// Helper to show development notice (only once per session)
let hasShownNotice = false;
export const showDevelopmentNotice = () => {
  if (!isTauriContext() && !hasShownNotice) {
    hasShownNotice = true;
    console.log(`
🚧 DEVELOPMENT MODE NOTICE 🚧
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You are running Codexia in BROWSER DEVELOPMENT MODE.

To access full functionality including authentication:
  bun tauri dev

Current mode limitations:
• Authentication features are not available
• No access to file system operations  
• No Codex CLI integration
• Limited functionality for UI development only

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    `);
  }
};
