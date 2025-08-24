import { safeInvoke } from "@/utils/tauriMock";
import { useAuthStore } from "@/stores/AuthStore";

class TokenManager {
  private refreshInterval: NodeJS.Timeout | null = null;
  private readonly REFRESH_INTERVAL = 45 * 60 * 1000; // 45 minutes

  start() {
    if (this.refreshInterval) {
      this.stop();
    }

    // Check if we need to refresh tokens periodically
    this.refreshInterval = setInterval(() => {
      this.checkAndRefreshTokens();
    }, this.REFRESH_INTERVAL);

    // Check immediately on start
    this.checkAndRefreshTokens();
  }

  stop() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  private async checkAndRefreshTokens() {
    const authState = useAuthStore.getState().auth;
    
    // Only refresh for ChatGPT authentication
    if (authState.type !== 'chatgpt') {
      return;
    }

    try {
      // The backend handles token refresh automatically when needed
      // We just need to check the status periodically
      await useAuthStore.getState().checkAuthStatus();
    } catch (error) {
      console.error('Token refresh check failed:', error);
    }
  }

  async refreshNow(): Promise<boolean> {
    try {
      const authState = useAuthStore.getState().auth;
      
      if (authState.type !== 'chatgpt') {
        console.warn('Cannot refresh: not using ChatGPT authentication');
        return false;
      }

      // Force a status check which will trigger refresh if needed
      await useAuthStore.getState().checkAuthStatus();
      
      const newAuthState = useAuthStore.getState().auth;
      return newAuthState.valid === true;
    } catch (error) {
      console.error('Token refresh failed:', error);
      return false;
    }
  }

  async getValidToken(): Promise<string | null> {
    try {
      const token = await safeInvoke('get_auth_token') as string | null;
      return token;
    } catch (error) {
      console.error('Failed to get auth token:', error);
      return null;
    }
  }
}

export const tokenManager = new TokenManager();

// Hook to use token manager in React components
export function useTokenManager() {
  return {
    start: () => tokenManager.start(),
    stop: () => tokenManager.stop(),
    refreshNow: () => tokenManager.refreshNow(),
    getValidToken: () => tokenManager.getValidToken(),
  };
}