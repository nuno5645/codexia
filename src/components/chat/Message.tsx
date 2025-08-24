import { memo } from 'react';
import { Copy, Check, ChevronDown, ChevronRight } from 'lucide-react';
import { MessageNoteActions } from './MessageNoteActions';
import { MarkdownRenderer } from './MarkdownRenderer';
import { useState } from 'react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ExecBlock } from './ExecBlock';
import { DiffBlock } from './DiffBlock';

interface NormalizedMessage {
  id: string;
  role: string;
  content: string;
  timestamp: number;
  isStreaming: boolean;
  model?: string;
}

interface MessageProps {
  message: NormalizedMessage;
  index: number;
  isLastMessage: boolean;
  selectedText: string;
}


const getMessageStyle = (role: string) => {
  switch (role) {
    case 'user':
      return 'bg-blue-50 border-blue-200';
    case 'assistant':
      return 'bg-white border-gray-200';
    case 'system':
      return 'bg-gray-50 border-gray-300';
    default:
      return 'bg-gray-50 border-gray-200';
  }
};

const formatTime = (timestamp: number) => {
  return new Date(timestamp).toLocaleTimeString([], { 
    hour: '2-digit', 
    minute: '2-digit' 
  });
};

export const Message = memo<MessageProps>(({ 
  message: normalized, 
  index, 
  isLastMessage, 
  selectedText 
}) => {
  const [copied, setCopied] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(true);
  
  const isEnvironmentContext = normalized.content.startsWith('<environment_context>');
  const isExecLike = normalized.role === 'system' && /(^cwd: |\n\$ |^\$ )/.test(normalized.content);
  const isDiffBlock = /^```diff[\s\S]*```$/m.test(normalized.content.trim()) || normalized.content.startsWith('diff --git ');
  
  const getWorkingDirectory = () => {
    if (!isEnvironmentContext) return '';
    const match = normalized.content.match(/Current working directory: ([^\n\r]+)/);
    return match ? match[1] : '';
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(normalized.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy text:', error);
    }
  };

  return (
    <div
      key={`${normalized.id}-${index}`}
      className={`group min-w-0 ${isLastMessage ? 'mb-4' : ''}`}
      data-message-role={normalized.role}
      data-message-timestamp={normalized.timestamp}
    >
      {normalized.content.length !== 0 && 
        <div className="w-full min-w-0">
          {/* Content */}
          <div className={`relative rounded-lg border px-3 py-2 w-full min-w-0 max-w-full ${getMessageStyle(normalized.role)}`}>
            <div className="break-words overflow-wrap-anywhere min-w-0 max-w-full overflow-hidden">
              {isEnvironmentContext ? (
                <Collapsible open={!isCollapsed} onOpenChange={(open) => setIsCollapsed(!open)}>
                  <CollapsibleTrigger asChild>
                    <div className="flex items-center gap-2 w-full text-left hover:bg-gray-100 px-2 py-1 rounded cursor-pointer">
                    {isCollapsed ? (
                      <ChevronRight className="w-4 h-4" />
                    ) : (
                      <ChevronDown className="w-4 h-4" />
                    )}
                    <span className="text-sm text-gray-600 font-mono">Environment Context</span>
                    {getWorkingDirectory() && (
                      <span className="text-xs text-gray-500 ml-2">
                        {getWorkingDirectory()}
                      </span>
                    )}
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-2">
                    <MarkdownRenderer content={normalized.content} />
                  </CollapsibleContent>
                </Collapsible>
              ) : isExecLike ? (
                <ExecBlock content={normalized.content} />
              ) : isDiffBlock ? (
                <DiffBlock content={normalized.content} />
              ) : (
                <>
                  <MarkdownRenderer content={normalized.content} />
                </>
              )}
            </div>
          </div>

          {/* Header */}
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">
                {formatTime(normalized.timestamp)}
              </span>
            </div>
            
            {/* Actions */}
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={handleCopy}
                className="p-1 hover:bg-gray-200 rounded transition-colors"
                title={copied ? "Copied!" : "Copy message"}
              >
                {copied ? (
                  <Check className="w-4 h-4 text-green-600" />
                ) : (
                  <Copy className="w-4 h-4 text-gray-600" />
                )}
              </button>
              <MessageNoteActions
                messageId={normalized.id}
                messageContent={normalized.content}
                messageRole={normalized.role}
                timestamp={normalized.timestamp}
                selectedText={selectedText}
              />
            </div>
          </div>
        </div>
      }
    </div>
  );
});
