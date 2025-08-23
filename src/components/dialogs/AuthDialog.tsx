import { useState, useEffect } from "react";
import { safeInvoke, isTauriContext, showDevelopmentNotice } from "@/utils/tauriMock";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { User, Key, LogIn, LogOut, Check, AlertCircle } from "lucide-react";

interface AuthStatus {
  type: 'none' | 'api_key' | 'chatgpt';
  email?: string;
  plan?: string;
  valid?: boolean;
}

export function AuthDialog() {
  const [isOpen, setIsOpen] = useState(false);
  const [authStatus, setAuthStatus] = useState<AuthStatus>({ type: 'none' });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [showApiKeyForm, setShowApiKeyForm] = useState(false);

  useEffect(() => {
    // Show development notice if running in browser
    showDevelopmentNotice();
    checkAuthStatus();
  }, []);

  const checkAuthStatus = async () => {
    try {
      console.log('🔍 Checking auth status...');
      console.log('🌐 Window context:', typeof window);
      console.log('🏗️ Tauri context:', isTauriContext());
      
      if (!isTauriContext()) {
        console.log('💻 Running in browser development mode');
      }
      
      const status = await safeInvoke('get_auth_status');
      console.log('✅ Auth status received:', status);
      
      if (!status) {
        setAuthStatus({ type: 'none' });
      } else if (status === 'api_key') {
        setAuthStatus({ type: 'api_key' });
      } else if (status.startsWith('chatgpt:')) {
        const parts = status.split(':');
        if (parts.length === 3) {
          const [, email, plan] = parts;
          setAuthStatus({ 
            type: 'chatgpt', 
            email, 
            plan, 
            valid: true 
          });
        } else if (parts[1] === 'invalid') {
          setAuthStatus({ 
            type: 'chatgpt', 
            valid: false 
          });
        } else {
          setAuthStatus({ type: 'chatgpt', valid: true });
        }
      }
    } catch (error) {
      console.error('❌ Failed to check auth status:', error);
      console.log('🔧 Error details:', {
        name: error?.name,
        message: error?.message,
        stack: error?.stack
      });
      setError('Failed to check authentication status');
    }
  };

  const handleChatGPTLogin = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      console.log('🚀 Starting OAuth flow...');
      
      const authUrl = await safeInvoke('start_login_flow');
      console.log('🔗 Auth URL received:', authUrl);
      
      // Use Tauri's opener plugin through invoke
      await safeInvoke('plugin:opener|open', { path: authUrl });
      console.log('🌐 Browser opened with auth URL');
      
      // Poll for completion (in a real app, you'd use events)
      const pollForCompletion = setInterval(async () => {
        try {
          const newStatus = await safeInvoke('get_auth_status');
          if (newStatus && newStatus.startsWith('chatgpt:')) {
            console.log('✅ OAuth completion detected:', newStatus);
            clearInterval(pollForCompletion);
            await checkAuthStatus();
            setIsLoading(false);
            setIsOpen(false);
          }
        } catch (error) {
          console.log('⏳ Polling error (continuing):', error?.message);
          // Continue polling
        }
      }, 2000);
      
      // Stop polling after 5 minutes
      setTimeout(() => {
        console.log('⏰ OAuth polling timeout reached');
        clearInterval(pollForCompletion);
        setIsLoading(false);
      }, 5 * 60 * 1000);
      
    } catch (error) {
      console.error('❌ Failed to start login flow:', error);
      setError(`Failed to start authentication flow: ${error?.message}`);
      setIsLoading(false);
    }
  };

  const handleApiKeyLogin = async () => {
    if (!apiKeyInput.trim()) {
      setError('Please enter an API key');
      return;
    }
    
    setIsLoading(true);
    setError(null);
    
    try {
      await safeInvoke('login_with_api_key_command', { apiKey: apiKeyInput.trim() });
      await checkAuthStatus();
      setApiKeyInput("");
      setShowApiKeyForm(false);
      setIsLoading(false);
      setIsOpen(false);
    } catch (error) {
      console.error('Failed to save API key:', error);
      setError('Failed to save API key');
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      await safeInvoke('logout_command');
      await checkAuthStatus();
      setIsLoading(false);
      setIsOpen(false);
    } catch (error) {
      console.error('Failed to logout:', error);
      setError('Failed to logout');
      setIsLoading(false);
    }
  };

  const getStatusDisplay = () => {
    switch (authStatus.type) {
      case 'none':
        return (
          <div className="flex items-center gap-2 text-muted-foreground">
            <AlertCircle className="w-4 h-4" />
            <span>Not authenticated</span>
          </div>
        );
      case 'api_key':
        return (
          <div className="flex items-center gap-2 text-green-600">
            <Check className="w-4 h-4" />
            <span>API Key</span>
            <Badge variant="outline">Active</Badge>
          </div>
        );
      case 'chatgpt':
        if (!authStatus.valid) {
          return (
            <div className="flex items-center gap-2 text-amber-600">
              <AlertCircle className="w-4 h-4" />
              <span>ChatGPT (Invalid)</span>
              <Badge variant="destructive">Needs Refresh</Badge>
            </div>
          );
        }
        return (
          <div className="flex items-center gap-2 text-green-600">
            <Check className="w-4 h-4" />
            <span>ChatGPT</span>
            {authStatus.email && (
              <Badge variant="outline">{authStatus.email}</Badge>
            )}
            {authStatus.plan && (
              <Badge variant="secondary">{authStatus.plan}</Badge>
            )}
          </div>
        );
    }
  };

  const isAuthenticated = authStatus.type !== 'none' && 
    (authStatus.type !== 'chatgpt' || authStatus.valid !== false);

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant={isAuthenticated ? "outline" : "default"} size="sm">
          {isAuthenticated ? <User className="w-4 h-4" /> : <LogIn className="w-4 h-4" />}
          {isAuthenticated ? "Account" : "Sign In"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Authentication</DialogTitle>
          <DialogDescription>
            Sign in to access AI models and sync your conversations
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-6">
          {/* Current Status */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Current Status</CardTitle>
            </CardHeader>
            <CardContent>
              {getStatusDisplay()}
            </CardContent>
          </Card>

          {error && (
            <div className="p-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md">
              {error}
            </div>
          )}

          {!isAuthenticated && (
            <div className="space-y-4">
              {/* ChatGPT OAuth (Recommended) */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <User className="w-4 h-4" />
                    Sign in with ChatGPT
                    <Badge>Recommended</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Use your existing ChatGPT account. No API keys needed.
                  </p>
                  <Button 
                    onClick={handleChatGPTLogin} 
                    disabled={isLoading}
                    className="w-full"
                  >
                    {isLoading ? "Opening browser..." : "Continue with ChatGPT"}
                  </Button>
                </CardContent>
              </Card>

              {/* API Key Alternative */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Key className="w-4 h-4" />
                    API Key
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {!showApiKeyForm ? (
                    <>
                      <p className="text-sm text-muted-foreground">
                        Use your OpenAI API key directly.
                      </p>
                      <Button 
                        variant="outline" 
                        onClick={() => setShowApiKeyForm(true)}
                        className="w-full"
                      >
                        Use API Key Instead
                      </Button>
                    </>
                  ) : (
                    <div className="space-y-3">
                      <Input
                        type="password"
                        placeholder="sk-..."
                        value={apiKeyInput}
                        onChange={(e) => setApiKeyInput(e.target.value)}
                        disabled={isLoading}
                      />
                      <div className="flex gap-2">
                        <Button 
                          onClick={handleApiKeyLogin}
                          disabled={isLoading || !apiKeyInput.trim()}
                          size="sm"
                        >
                          Save
                        </Button>
                        <Button 
                          variant="outline"
                          onClick={() => {
                            setShowApiKeyForm(false);
                            setApiKeyInput("");
                          }}
                          size="sm"
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {isAuthenticated && (
            <div className="space-y-4">
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-medium">Signed In</h3>
                      <p className="text-sm text-muted-foreground">
                        You're ready to use Codexia
                      </p>
                    </div>
                    <Button 
                      variant="outline"
                      onClick={handleLogout}
                      disabled={isLoading}
                      size="sm"
                    >
                      <LogOut className="w-4 h-4 mr-2" />
                      Sign Out
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}