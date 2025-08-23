import { useEffect } from 'react';
import { useAuthStore } from '@/stores/AuthStore';
import { tokenManager } from '@/services/tokenManager';

export function useAuthInitialization() {
  const checkAuthStatus = useAuthStore((state) => state.checkAuthStatus);
  const authType = useAuthStore((state) => state.auth.type);
  
  useEffect(() => {
    // Check authentication status on app startup
    checkAuthStatus();
  }, [checkAuthStatus]);

  useEffect(() => {
    // Start token manager when authenticated with ChatGPT
    if (authType === 'chatgpt') {
      tokenManager.start();
    } else {
      tokenManager.stop();
    }

    // Cleanup on unmount
    return () => {
      tokenManager.stop();
    };
  }, [authType]);
}