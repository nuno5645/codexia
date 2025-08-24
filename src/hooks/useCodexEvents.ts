import { useEffect, useRef, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { ChatMessage, CodexEvent, ApprovalRequest } from '@/types/codex';
import { useConversationStore } from '../stores/ConversationStore';
import { StreamController, StreamControllerSink } from '@/utils/streamController';

interface UseCodexEventsProps {
  sessionId: string;
  onApprovalRequest: (request: ApprovalRequest) => void;
}

// Helper function to extract session ID from codex events
const getEventSessionId = (event: CodexEvent): string | null => {
  const { msg } = event;
  switch (msg.type) {
    case 'session_configured':
      return msg.session_id;
    default:
      return null; // For other events, we can't determine session ID, so process them
  }
};

export const useCodexEvents = ({ 
  sessionId, 
  onApprovalRequest
}: UseCodexEventsProps) => {
  const { addMessage, updateMessage, setSessionLoading, createConversation, conversations } = useConversationStore();
  const streamController = useRef<StreamController>(new StreamController());
  const currentStreamingMessageId = useRef<string | null>(null);
  const currentStreamingBuffer = useRef<string>('');
  
  // Duplicate-suppression and per-event streams
  const agentStreams = useRef(new Map<string, { messageId: string; buffer: string }>());
  const reasoningStreams = useRef(new Map<string, { messageId: string; buffer: string }>());
  const agentFlush = useRef(new Map<string, number>());
  const reasoningFlush = useRef(new Map<string, number>());
  // Track live exec output streams by call_id
  const execStreams = useRef(new Map<string, { messageId: string; buffer: string }>());
  // Track diffs shown within the current turn to avoid duplicates
  const shownDiffs = useRef<Set<string>>(new Set());

  const addMessageToStore = (message: ChatMessage) => {
    // Ensure conversation exists
    const conversationExists = conversations.find(conv => conv.id === sessionId);
    if (!conversationExists) {
      console.log(`Creating conversation for session ${sessionId} from event`);
      createConversation('New Chat', 'agent', sessionId);
    }
    
    // Convert message format and add to store
    const conversationMessage = {
      id: message.id,
      role: message.type === 'user' ? 'user' as const : message.type === 'agent' ? 'assistant' as const : 'system' as const,
      content: message.content,
      timestamp: message.timestamp.getTime(),
    };
    console.log(`Adding message to session ${sessionId}:`, conversationMessage.content.substring(0, 100));
    addMessage(sessionId, conversationMessage);
  };

  // Stream sink is no longer used; we stream by direct appends for immediate UX
  const scheduleFlush = useCallback((which: 'agent' | 'reasoning', id: string) => {
    const map = which === 'agent' ? agentStreams.current : reasoningStreams.current;
    const flags = which === 'agent' ? agentFlush.current : reasoningFlush.current;
    if (flags.has(id)) return;
    const raf = (cb: FrameRequestCallback) =>
      (typeof window !== 'undefined' && 'requestAnimationFrame' in window)
        ? window.requestAnimationFrame(cb)
        : (setTimeout(() => cb(Date.now()), 16) as unknown as number);
    const cancel = (h: number) =>
      (typeof window !== 'undefined' && 'cancelAnimationFrame' in window)
        ? window.cancelAnimationFrame(h)
        : clearTimeout(h as unknown as NodeJS.Timeout);
    const handle = raf(() => {
      flags.delete(id);
      const st = map.get(id);
      if (st) {
        updateMessage(sessionId, st.messageId, { content: st.buffer });
      }
    });
    flags.set(id, handle);
    return () => {
      const h = flags.get(id);
      if (h) cancel(h);
      flags.delete(id);
    };
  }, [sessionId, updateMessage]);

  const handleCodexEvent = (event: CodexEvent) => {
    const { msg } = event;
    
    switch (msg.type) {
      case 'session_configured':
        console.log('Session configured:', msg.session_id);
        // Session is now configured and ready
        break;
      case 'turn_started':
        streamController.current.clearAll();
        currentStreamingMessageId.current = null;
        currentStreamingBuffer.current = '';
        shownDiffs.current.clear();
        setSessionLoading(sessionId, true);
        break;
        
      case 'task_started':
        setSessionLoading(sessionId, true);
        // Clear any previous streaming state
        streamController.current.clearAll();
        currentStreamingMessageId.current = null;
        break;
        
      case 'task_complete':
        console.log('🔄 Task complete event received, setting loading to false');
        setSessionLoading(sessionId, false);
        // Finalize any ongoing stream
        if (currentStreamingMessageId.current) {
          streamController.current.finalize(true);
          currentStreamingMessageId.current = null;
        }
        break;
      
      case 'turn_complete':
        // Treat turn_complete as end of streaming as well
        setSessionLoading(sessionId, false);
        if (currentStreamingMessageId.current) {
          streamController.current.finalize(true);
          currentStreamingMessageId.current = null;
        }
        shownDiffs.current.clear();
        break;
      case 'turn_aborted': {
        const m: ChatMessage = {
          id: `${sessionId}-turn-abort-${Date.now()}`,
          type: 'system',
          content: `Turn aborted`,
          timestamp: new Date(),
        };
        addMessageToStore(m);
        setSessionLoading(sessionId, false);
        streamController.current.clearAll();
        currentStreamingMessageId.current = null;
        currentStreamingBuffer.current = '';
        shownDiffs.current.clear();
        break;
      }
        
      case 'agent_message': {
        const id = event.id;
        const text = (msg.message || '').toString();
        const existing = agentStreams.current.get(id);
        if (!text) break;

        if (!existing) {
          // First appearance of this id: render a new line and track it
          const messageId = `${sessionId}-agent-${Date.now()}`;
          agentStreams.current.set(id, { messageId, buffer: text });
          addMessageToStore({ id: messageId, type: 'agent', content: text, timestamp: new Date() });
        } else {
          const prev = existing.buffer || '';
          if (text !== prev) {
            // Web-server behavior: when agent_message for same id differs, render a NEW line
            const messageId = `${sessionId}-agent-${Date.now()}`;
            agentStreams.current.set(id, { messageId, buffer: text });
            addMessageToStore({ id: messageId, type: 'agent', content: text, timestamp: new Date() });
          }
          // if equal, ignore
        }
        break;
      }
        
      case 'agent_message_delta': {
        const id = event.id;
        const delta = (msg.delta || '').toString();
        let st = agentStreams.current.get(id);
        if (!st) {
          const messageId = `${sessionId}-agent-${Date.now()}`;
          st = { messageId, buffer: '' };
          agentStreams.current.set(id, st);
          const streamingMessage: ChatMessage = {
            id: messageId,
            type: 'agent',
            content: '',
            timestamp: new Date(),
            isStreaming: true,
          };
          addMessageToStore(streamingMessage);
        }
        if (delta) {
          st.buffer += delta;
          scheduleFlush('agent', id);
        }
        break;
      }

      case 'agent_reasoning_delta':
      case 'agent_reasoning_raw_content_delta': {
        const id = event.id;
        const delta = ((msg as any).delta || '').toString();
        let st = reasoningStreams.current.get(id);
        if (!st) {
          const messageId = `${sessionId}-reasoning-${Date.now()}`;
          st = { messageId, buffer: '' };
          reasoningStreams.current.set(id, st);
          const streamingMessage: ChatMessage = {
            id: messageId,
            type: 'agent',
            content: '',
            timestamp: new Date(),
            isStreaming: true,
          };
          addMessageToStore(streamingMessage);
        }
        if (delta) {
          st.buffer += delta;
          scheduleFlush('reasoning', id);
        }
        break;
      }

      case 'agent_reasoning':
      case 'agent_reasoning_raw_content': {
        const id = event.id;
        const text = ((msg as any).text || '').toString();
        const st = reasoningStreams.current.get(id);
        if (st) {
          st.buffer = text || st.buffer;
          updateMessage(sessionId, st.messageId, { content: st.buffer, isStreaming: false });
          reasoningStreams.current.delete(id);
        } else if (text) {
          const messageId = `${sessionId}-reasoning-${Date.now()}`;
          const m: ChatMessage = {
            id: messageId,
            type: 'agent',
            content: text,
            timestamp: new Date(),
          };
          addMessageToStore(m);
        }
        setSessionLoading(sessionId, false);
        break;
      }

      case 'agent_reasoning_section_break': {
        const id = event.id;
        const st = reasoningStreams.current.get(id);
        if (st) {
          st.buffer += "\n\n";
          updateMessage(sessionId, st.messageId, { content: st.buffer });
        }
        break;
      }

      case 'token_count':
        // Optional: we could surface token counts in the UI later
        console.log('Token usage:', msg);
        break;
      case 'token_count_update':
        console.log('Token usage (update):', msg);
        break;
      case 'plan_update': {
        const lines = (msg.plan || []).map(p => `- [${p.status}] ${p.step}`);
        const content = [`Plan update:`, ...lines].join('\n');
        const m: ChatMessage = {
          id: `${sessionId}-plan-${Date.now()}`,
          type: 'system',
          content,
          timestamp: new Date(),
        };
        addMessageToStore(m);
        break;
      }
      case 'turn_diff': {
        const raw = (msg.unified_diff || '').toString();
        if (!raw) break;
        if (shownDiffs.current.has(raw)) {
          break; // skip identical diff already shown in this turn
        }
        shownDiffs.current.add(raw);
        const content = '```diff\n' + raw + '\n```';
        const m: ChatMessage = {
          id: `${sessionId}-diff-${Date.now()}`,
          type: 'system',
          content,
          timestamp: new Date(),
        };
        addMessageToStore(m);
        break;
      }
        
      case 'exec_approval_request':
        onApprovalRequest({
          id: event.id,
          type: 'exec',
          command: msg.command,
          cwd: msg.cwd,
        });
        break;

      case 'patch_approval_request':
        onApprovalRequest({
          id: event.id,
          type: 'patch',
          patch: msg.patch,
          files: msg.files,
        });
        break;
      case 'apply_patch_approval_request':
        onApprovalRequest({
          id: event.id,
          type: 'patch',
          patch: (msg as any).patch,
          files: (msg as any).files,
        });
        break;

      case 'exec_command_begin': {
        // Start a new message to stream exec output
        const callId = msg.call_id;
        const command = (msg.command || []).join(' ');
        const headerLines: string[] = [];
        if (msg.cwd) headerLines.push(`cwd: ${msg.cwd}`);
        headerLines.push(`$ ${command}`);
        const messageId = `${sessionId}-exec-${callId}-${Date.now()}`;
        const execMessage: ChatMessage = {
          id: messageId,
          type: 'system',
          content: headerLines.join('\n') + '\n',
          timestamp: new Date(),
          isStreaming: true,
        };
        addMessageToStore(execMessage);
        execStreams.current.set(callId, { messageId, buffer: execMessage.content });
        setSessionLoading(sessionId, true);
        break;
      }

      case 'exec_command_output_delta': {
        const callId = msg.call_id;
        const st = execStreams.current.get(callId);
        if (st) {
          try {
            const bytes = new Uint8Array(msg.chunk || []);
            const text = new TextDecoder().decode(bytes);
            const next = st.buffer + text;
            st.buffer = next;
            updateMessage(sessionId, st.messageId, { content: next });
          } catch {
            // Fallback: append as joined numbers
            const text = (msg.chunk || []).join(',');
            const next = st.buffer + text;
            st.buffer = next;
            updateMessage(sessionId, st.messageId, { content: next });
          }
        }
        break;
      }

      case 'exec_command_end': {
        const callId = msg.call_id;
        const st = execStreams.current.get(callId);
        if (st) {
          const exitLine = `\nexit ${msg.exit_code}`;
          const next = st.buffer + exitLine;
          st.buffer = next;
          updateMessage(sessionId, st.messageId, { content: next, isStreaming: false });
          execStreams.current.delete(callId);
        }
        setSessionLoading(sessionId, false);
        break;
      }
      case 'patch_apply_begin': {
        const m: ChatMessage = {
          id: `${sessionId}-patch-begin-${Date.now()}`,
          type: 'system',
          content: 'Applying patch…',
          timestamp: new Date(),
        };
        addMessageToStore(m);
        setSessionLoading(sessionId, true);
        break;
      }
      case 'patch_apply_end': {
        const ok = (msg as any).success ? 'ok' : 'failed';
        const m: ChatMessage = {
          id: `${sessionId}-patch-end-${Date.now()}`,
          type: 'system',
          content: `Patch apply ${ok}`,
          timestamp: new Date(),
        };
        addMessageToStore(m);
        setSessionLoading(sessionId, false);
        break;
      }
        
      case 'error':
        const errorMessage: ChatMessage = {
          id: `${sessionId}-error-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
          type: 'system',
          content: `Error: ${msg.message}`,
          timestamp: new Date(),
        };
        addMessageToStore(errorMessage);
        setSessionLoading(sessionId, false);
        break;
        
      case 'shutdown_complete':
        console.log('Session shutdown completed');
        // Clean up streaming state on shutdown
        streamController.current.clearAll();
        currentStreamingMessageId.current = null;
        break;
        
      case 'background_event':
        console.log('Background event:', msg.message);
        break;
        
      
        
      default:
        console.log('Unhandled event type:', msg.type);
    }
  };

  useEffect(() => {
    if (!sessionId) return;

    // Listen to the global codex-events channel
    const eventUnlisten = listen<CodexEvent>("codex-events", (event) => {
      const codexEvent = event.payload;
      
      // Check if this event is for our session
      const eventSessionId = getEventSessionId(codexEvent);
      const ourSessionId = sessionId.replace('codex-event-', '');
      
      if (eventSessionId && eventSessionId !== ourSessionId) {
        // This event is for a different session, ignore it
        return;
      }
      
      console.log(`Received codex event for session ${sessionId}:`, codexEvent);
      handleCodexEvent(codexEvent);
    });
    
    // Cleanup function
    return () => {
      eventUnlisten.then(fn => fn());
      // Clear streaming state when component unmounts or sessionId changes
      streamController.current.clearAll();
      currentStreamingMessageId.current = null;
    };
  }, [sessionId]);

  return {};
};
