import type { PlaygroundState } from '../playground-state';

export type AgentMode = 'idle' | 'thinking' | 'executing' | 'replying' | 'waiting' | 'starting' | 'stopping';

export function agentMode(state: PlaygroundState, status: string, desktop: boolean): AgentMode {
  if (state.error) return 'idle';
  if (['stopping', 'stopping reply'].includes(state.phase)) return 'stopping';
  if (state.busy) {
    if (state.phase === 'executing approved action' || state.phase === 'filling private login') return 'executing';
    if (['starting VM', 'preparing practice form', 'preparing web browser'].includes(state.phase)) return 'starting';
    if (state.phase === 'thinking' || state.phase === 'verifying task') return 'thinking';
    if (state.phase === 'generating text') return status === 'streaming' ? 'replying' : 'thinking';
  }
  if (status === 'submitted' || status === 'streaming') return status === 'streaming' && !desktop ? 'replying' : 'thinking';
  return state.pending || state.credential_request ? 'waiting' : 'idle';
}

export const agentLabels: Record<AgentMode, string> = {
  idle: 'Ready', thinking: 'Thinking', executing: 'Taking action', replying: 'Writing',
  waiting: 'Waiting for your approval', starting: 'Preparing the desktop', stopping: 'Stopping the sandbox',
};
