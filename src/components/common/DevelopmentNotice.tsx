import { useState, useEffect } from 'react';
import { isTauriContext } from '@/utils/tauriMock';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertTriangle, X, Terminal } from 'lucide-react';

export function DevelopmentNotice() {
  const [isVisible, setIsVisible] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  useEffect(() => {
    // Show notice if not in Tauri context and not dismissed
    if (!isTauriContext() && !isDismissed) {
      setIsVisible(true);
    }
  }, [isDismissed]);

  const handleDismiss = () => {
    setIsDismissed(true);
    setIsVisible(false);
  };

  if (!isVisible) {
    return null;
  }

  return (
    <div className="fixed top-0 left-0 right-0 z-50 p-4">
      <Card className="border-amber-200 bg-amber-50 shadow-lg">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-amber-800 mb-1">
                🚧 Development Mode - Limited Functionality
              </h3>
              <p className="text-sm text-amber-700 mb-3">
                You're running Codexia in browser development mode. 
                For full authentication and Codex CLI features, please run:
              </p>
              
              <div className="bg-slate-900 text-slate-100 px-3 py-2 rounded-md font-mono text-sm mb-3 flex items-center gap-2">
                <Terminal className="w-4 h-4" />
                <code>bun tauri dev</code>
              </div>
              
              <p className="text-xs text-amber-600">
                In browser mode: Authentication is mocked, file operations are disabled, 
                and Codex CLI integration is not available.
              </p>
            </div>
            
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDismiss}
              className="text-amber-600 hover:text-amber-800 hover:bg-amber-100 flex-shrink-0"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}