import { create } from "zustand";
import { persist } from "zustand/middleware";
import { safeInvoke } from "@/utils/tauriMock";

export interface AuthState {
  type: 'none' | 'api_key' | 'chatgpt';
  email?: string;
  plan?: string;
  valid?: boolean;
  isLoading: boolean;
  error?: string;
}

interface AuthStore {
  auth: AuthState;
  checkAuthStatus: () => Promise<void>;
  startOAuthFlow: () => Promise<void>;
  loginWithApiKey: (apiKey: string) => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
  setLoading: (loading: boolean) => void;
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set, get) => ({
      auth: {
        type: 'none',
        isLoading: false,
      },

      checkAuthStatus: async () => {
        try {
          console.log('🔍 [AuthStore] Checking auth status...');
          
          set((state) => ({ 
            auth: { ...state.auth, isLoading: true, error: undefined } 
          }));

          const status = await safeInvoke('get_auth_status') as string | null;
          console.log('✅ [AuthStore] Auth status received:', status);
          
          if (!status) {
            set({ auth: { type: 'none', isLoading: false } });
          } else if (status === 'api_key') {
            set({ auth: { type: 'api_key', isLoading: false } });
          } else if (status.startsWith('chatgpt:')) {
            const parts = status.split(':');
            if (parts.length === 3) {
              const [, email, plan] = parts;
              set({ 
                auth: { 
                  type: 'chatgpt', 
                  email, 
                  plan, 
                  valid: true, 
                  isLoading: false 
                } 
              });
            } else if (parts[1] === 'invalid') {
              set({ 
                auth: { 
                  type: 'chatgpt', 
                  valid: false, 
                  isLoading: false 
                } 
              });
            } else {
              set({ 
                auth: { 
                  type: 'chatgpt', 
                  valid: true, 
                  isLoading: false 
                } 
              });
            }
          }
        } catch (error: any) {
          console.error('❌ [AuthStore] Failed to check auth status:', error);
          console.log('🔧 [AuthStore] Error details:', {
            name: error?.name,
            message: error?.message,
            stack: error?.stack
          });
          
          // Check if we're in browser mode
          if (error?.message?.includes('outside Tauri context')) {
            set({ 
              auth: { 
                type: 'none', 
                isLoading: false, 
                error: 'Authentication not available in browser mode. Run `bun tauri dev` for full functionality.' 
              } 
            });
          } else {
            set((state) => ({ 
              auth: { 
                ...state.auth, 
                isLoading: false, 
                error: `Failed to check authentication status: ${error?.message}` 
              } 
            }));
          }
        }
      },

      startOAuthFlow: async () => {
        try {
          set((state) => ({ 
            auth: { ...state.auth, isLoading: true, error: undefined } 
          }));

          const authUrl = await safeInvoke('start_login_flow');
          
          // Open the auth URL in the default browser
          await safeInvoke('plugin:opener|open', { path: authUrl });
          
          // Start polling for completion
          const pollForCompletion = () => {
            const interval = setInterval(async () => {
              try {
                const newStatus = await safeInvoke('get_auth_status') as string | null;
                if (newStatus && newStatus.startsWith('chatgpt:')) {
                  clearInterval(interval);
                  await get().checkAuthStatus();
                }
              } catch (error) {
                // Continue polling
              }
            }, 2000);
            
            // Stop polling after 5 minutes
            setTimeout(() => {
              clearInterval(interval);
              set((state) => ({ 
                auth: { ...state.auth, isLoading: false } 
              }));
            }, 5 * 60 * 1000);
          };
          
          pollForCompletion();
          
        } catch (error: any) {
          console.error('Failed to start OAuth flow:', error);
          if (error?.message?.includes('outside Tauri context')) {
            set((state) => ({ 
              auth: { 
                ...state.auth, 
                isLoading: false, 
                error: 'OAuth not available in browser mode. Run `bun tauri dev` for authentication.' 
              } 
            }));
          } else {
            set((state) => ({ 
              auth: { 
                ...state.auth, 
                isLoading: false, 
                error: 'Failed to start authentication flow' 
              } 
            }));
          }
        }
      },

      loginWithApiKey: async (apiKey: string) => {
        try {
          set((state) => ({ 
            auth: { ...state.auth, isLoading: true, error: undefined } 
          }));

          await safeInvoke('login_with_api_key_command', { apiKey });
          await get().checkAuthStatus();
          
        } catch (error) {
          console.error('Failed to login with API key:', error);
          set((state) => ({ 
            auth: { 
              ...state.auth, 
              isLoading: false, 
              error: 'Failed to save API key' 
            } 
          }));
        }
      },

      logout: async () => {
        try {
          set((state) => ({ 
            auth: { ...state.auth, isLoading: true, error: undefined } 
          }));

          await safeInvoke('logout_command');
          set({ auth: { type: 'none', isLoading: false } });
          
        } catch (error) {
          console.error('Failed to logout:', error);
          set((state) => ({ 
            auth: { 
              ...state.auth, 
              isLoading: false, 
              error: 'Failed to logout' 
            } 
          }));
        }
      },

      clearError: () => {
        set((state) => ({ 
          auth: { ...state.auth, error: undefined } 
        }));
      },

      setLoading: (loading: boolean) => {
        set((state) => ({ 
          auth: { ...state.auth, isLoading: loading } 
        }));
      },
    }),
    {
      name: "auth-storage",
      partialize: (state) => ({ 
        auth: {
          type: state.auth.type,
          email: state.auth.email,
          plan: state.auth.plan,
          valid: state.auth.valid,
          // Don't persist loading or error states
        }
      }),
    }
  )
);

// Helper hook to check if user is authenticated
export const useIsAuthenticated = () => {
  const auth = useAuthStore((state) => state.auth);
  return auth.type !== 'none' && (auth.type !== 'chatgpt' || auth.valid !== false);
};