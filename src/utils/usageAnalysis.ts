import { invoke } from '@tauri-apps/api/core';
import { safeInvoke } from './tauriMock';

export interface TokenUsage {
  input_tokens: number;
  cached_input_tokens?: number;
  output_tokens: number;
  reasoning_output_tokens?: number;
  total_tokens: number;
}

export interface SessionData {
  id: string;
  timestamp: string;
  git?: {
    repository_url?: string;
  };
  project_path?: string;
  model?: string;
}

export interface SessionMetrics {
  sessionId: string;
  timestamp: Date;
  projectPath: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  estimatedCost: number;
}

export interface UsageSummary {
  totalCost: number;
  totalSessions: number;
  totalTokens: number;
  avgCostPerSession: number;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  modelBreakdown: Record<string, { sessions: number; cost: number; tokens: number }>;
  projectBreakdown: Record<string, { sessions: number; cost: number; tokens: number }>;
  timelineData: Array<{ date: string; cost: number; tokens: number; sessions: number }>;
}

// Cost per million tokens (estimated based on common model pricing)
const MODEL_COSTS: Record<string, { input: number; output: number; cache_write: number; cache_read: number }> = {
  'gpt-5-high': { input: 15, output: 75, cache_write: 18.75, cache_read: 1.5 },
  'gpt-5': { input: 3, output: 15, cache_write: 3.75, cache_read: 0.3 },
  'gpt-5-mini': { input: 0.25, output: 1.25, cache_write: 0.3, cache_read: 0.03 },
  'gpt-4': { input: 30, output: 60, cache_write: 30, cache_read: 3 },
  'gpt-3.5-turbo': { input: 0.5, output: 1.5, cache_write: 0.5, cache_read: 0.05 },
  'llama3.2': { input: 0, output: 0, cache_write: 0, cache_read: 0 }, // OSS model
};

function calculateTokenCost(usage: TokenUsage, model: string): number {
  const costs = MODEL_COSTS[model] || MODEL_COSTS['claude-3-5-sonnet-20241022']; // Default to Sonnet
  
  const inputCost = (usage.input_tokens / 1_000_000) * costs.input;
  const outputCost = (usage.output_tokens / 1_000_000) * costs.output;
  const cacheWriteCost = ((usage.cached_input_tokens || 0) / 1_000_000) * costs.cache_write;
  const cacheReadCost = 0; // Assuming cache read is included in input tokens
  
  return inputCost + outputCost + cacheWriteCost + cacheReadCost;
}

export async function getSessionFiles(): Promise<string[]> {
  try {
    return await safeInvoke('get_session_files') as string[];
  } catch (error) {
    console.error('Failed to get session files:', error);
    return [];
  }
}

export async function parseSessionFile(filePath: string): Promise<SessionMetrics | null> {
  try {
    const content: string = await invoke('read_session_file', { filePath });
    const lines = content.split('\n').filter(line => line.trim());
    
    if (lines.length === 0) return null;
    
    // Parse the session header
    const headerLine = lines.find(line => {
      try {
        const parsed = JSON.parse(line);
        return parsed.id && parsed.timestamp;
      } catch {
        return false;
      }
    });
    
    if (!headerLine) return null;
    
    const sessionData: SessionData = JSON.parse(headerLine);
    
    // Extract token usage from events in the session
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCacheTokens = 0;
    let model = 'claude-3-5-sonnet-20241022'; // Default
    
    // Count messages as a proxy for usage when actual token data is not available
    let messageCount = 0;
    let hasUserMessages = false;
    let hasAssistantMessages = false;
    
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        
        // Look for token count events (actual usage data)
        if (event.msg?.type === 'token_count' && event.msg.usage) {
          const usage: TokenUsage = event.msg.usage;
          totalInputTokens += usage.input_tokens;
          totalOutputTokens += usage.output_tokens;
          totalCacheTokens += usage.cached_input_tokens || 0;
        }
        
        // Look for messages to estimate usage when no token data available
        if (event.type === 'message') {
          messageCount++;
          if (event.role === 'user') {
            hasUserMessages = true;
          } else if (event.role === 'assistant') {
            hasAssistantMessages = true;
          }
        }
        
        // Extract model info from various sources
        if (event.msg?.model) {
          model = event.msg.model;
        }
        if (event.model) {
          model = event.model;
        }
        
        // Check for git repo info to determine if it's Claude Code usage
        if (event.git?.repository_url && event.git.repository_url.includes('codexia')) {
          model = 'gpt-5-high'; // Likely using Claude 4 for development
        }
      } catch {
        // Skip invalid JSON lines
      }
    }
    
    // If no actual token data, estimate based on messages
    if (totalInputTokens === 0 && totalOutputTokens === 0 && hasUserMessages && hasAssistantMessages) {
      // Rough estimation: user input ~100 tokens, assistant response ~300 tokens per exchange
      const estimatedExchanges = Math.ceil(messageCount / 2);
      totalInputTokens = estimatedExchanges * 150; // Average input
      totalOutputTokens = estimatedExchanges * 400; // Average output
      totalCacheTokens = estimatedExchanges * 50; // Some caching
    }
    
    const totalTokens = totalInputTokens + totalOutputTokens;
    
    // Skip sessions with no meaningful activity
    if (totalTokens === 0 && messageCount < 2) {
      return null;
    }
    
    // Extract project path from git repo or session path
    let projectPath = sessionData.git?.repository_url || filePath;
    if (projectPath.includes('/')) {
      projectPath = projectPath.split('/').pop() || projectPath;
    }
    if (projectPath.includes('.git')) {
      projectPath = projectPath.replace('.git', '');
    }
    if (projectPath.startsWith('git@github.com:')) {
      projectPath = projectPath.replace('git@github.com:', '').replace('.git', '');
    }
    
    const estimatedCost = calculateTokenCost({
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
      cached_input_tokens: totalCacheTokens,
      total_tokens: totalTokens,
    }, model);
    
    return {
      sessionId: sessionData.id,
      timestamp: new Date(sessionData.timestamp),
      projectPath: projectPath || 'Unknown Project',
      model,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      cacheWriteTokens: totalCacheTokens,
      cacheReadTokens: 0, // Calculated separately if needed
      totalTokens,
      estimatedCost,
    };
  } catch (error) {
    console.error(`Failed to parse session file ${filePath}:`, error);
    return null;
  }
}

export async function getHistoryData(): Promise<Array<{ sessionId: string; timestamp: Date; text: string }>> {
  try {
    const content: string = await invoke('read_history_file');
    const lines = content.split('\n').filter(line => line.trim());
    
    return lines.map(line => {
      const parsed = JSON.parse(line);
      return {
        sessionId: parsed.session_id,
        timestamp: new Date(parsed.ts * 1000), // Convert Unix timestamp
        text: parsed.text,
      };
    }).filter(Boolean);
  } catch (error) {
    console.error('Failed to read history file:', error);
    return [];
  }
}

export async function calculateUsageSummary(): Promise<UsageSummary> {
  const sessionFiles = await getSessionFiles();
  const sessionMetrics: SessionMetrics[] = [];
  
  // Parse all session files
  for (const file of sessionFiles) {
    const metrics = await parseSessionFile(file);
    if (metrics && metrics.totalTokens > 0) {
      sessionMetrics.push(metrics);
    }
  }
  
  // Calculate summary statistics
  const totalCost = sessionMetrics.reduce((sum, m) => sum + m.estimatedCost, 0);
  const totalSessions = sessionMetrics.length;
  const totalTokens = sessionMetrics.reduce((sum, m) => sum + m.totalTokens, 0);
  const avgCostPerSession = totalSessions > 0 ? totalCost / totalSessions : 0;
  
  const inputTokens = sessionMetrics.reduce((sum, m) => sum + m.inputTokens, 0);
  const outputTokens = sessionMetrics.reduce((sum, m) => sum + m.outputTokens, 0);
  const cacheWriteTokens = sessionMetrics.reduce((sum, m) => sum + m.cacheWriteTokens, 0);
  const cacheReadTokens = sessionMetrics.reduce((sum, m) => sum + m.cacheReadTokens, 0);
  
  // Model breakdown
  const modelBreakdown: Record<string, { sessions: number; cost: number; tokens: number }> = {};
  for (const metric of sessionMetrics) {
    if (!modelBreakdown[metric.model]) {
      modelBreakdown[metric.model] = { sessions: 0, cost: 0, tokens: 0 };
    }
    modelBreakdown[metric.model].sessions++;
    modelBreakdown[metric.model].cost += metric.estimatedCost;
    modelBreakdown[metric.model].tokens += metric.totalTokens;
  }
  
  // Project breakdown
  const projectBreakdown: Record<string, { sessions: number; cost: number; tokens: number }> = {};
  for (const metric of sessionMetrics) {
    if (!projectBreakdown[metric.projectPath]) {
      projectBreakdown[metric.projectPath] = { sessions: 0, cost: 0, tokens: 0 };
    }
    projectBreakdown[metric.projectPath].sessions++;
    projectBreakdown[metric.projectPath].cost += metric.estimatedCost;
    projectBreakdown[metric.projectPath].tokens += metric.totalTokens;
  }
  
  // Timeline data (group by date)
  const timelineMap: Record<string, { cost: number; tokens: number; sessions: number }> = {};
  for (const metric of sessionMetrics) {
    const date = metric.timestamp.toISOString().split('T')[0];
    if (!timelineMap[date]) {
      timelineMap[date] = { cost: 0, tokens: 0, sessions: 0 };
    }
    timelineMap[date].cost += metric.estimatedCost;
    timelineMap[date].tokens += metric.totalTokens;
    timelineMap[date].sessions++;
  }
  
  const timelineData = Object.entries(timelineMap)
    .map(([date, data]) => ({ date, ...data }))
    .sort((a, b) => a.date.localeCompare(b.date));
  
  return {
    totalCost,
    totalSessions,
    totalTokens,
    avgCostPerSession,
    inputTokens,
    outputTokens,
    cacheWriteTokens,
    cacheReadTokens,
    modelBreakdown,
    projectBreakdown,
    timelineData,
  };
}