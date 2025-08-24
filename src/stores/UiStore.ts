import { create } from 'zustand';

export interface TokenUsage {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
  total_tokens?: number;
}

interface UiState {
  showReasoning: boolean;
  activeExecs: number;
  activePatches: number;
  tokenUsage?: TokenUsage;
  // actions
  toggleReasoning: () => void;
  setShowReasoning: (v: boolean) => void;
  incExec: () => void;
  decExec: () => void;
  incPatch: () => void;
  decPatch: () => void;
  setTokenUsage: (u: TokenUsage) => void;
}

export const useUiStore = create<UiState>((set) => ({
  showReasoning: false,
  activeExecs: 0,
  activePatches: 0,
  tokenUsage: undefined,
  toggleReasoning: () => set((s) => ({ showReasoning: !s.showReasoning })),
  setShowReasoning: (v: boolean) => set({ showReasoning: v }),
  incExec: () => set((s) => ({ activeExecs: s.activeExecs + 1 })),
  decExec: () => set((s) => ({ activeExecs: Math.max(0, s.activeExecs - 1) })),
  incPatch: () => set((s) => ({ activePatches: s.activePatches + 1 })),
  decPatch: () => set((s) => ({ activePatches: Math.max(0, s.activePatches - 1) })),
  setTokenUsage: (u: TokenUsage) => set({ tokenUsage: u }),
}));

