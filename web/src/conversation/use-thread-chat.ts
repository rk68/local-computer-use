import { useMutation } from 'convex/react';
import { useUIMessages } from '@convex-dev/agent/react';
import { useState } from 'react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';

export function useThreadChat(token: string, threadId: Id<'threads'>, run: { kind: string; status: string } | null, runError?: string) {
  const history = useUIMessages(api.workspace.messages, { token, threadId }, { initialNumItems: 40, stream: true });
  const send = useMutation(api.runs.send);
  const cancel = useMutation(api.workspace.cancel);
  const [error, setError] = useState<Error>();
  const active = !!run && run.kind === 'text' && ['queued', 'running', 'cancelled'].includes(run.status);
  const status = active ? history.results.some(m => m.status === 'streaming') ? 'streaming' : 'submitted' : 'ready';
  return {
    messages: history.results, status, error: error ?? (runError ? new Error(runError) : undefined),
    clearError: () => setError(undefined),
    async sendMessage({ text }: { text: string }, options: { body: { desktop: boolean } }) {
      try { await send({ token, threadId, text, desktop: options.body.desktop }); }
      catch (failure) { setError(failure as Error); throw failure; }
    },
    async stopGeneration() { await cancel({ token, threadId }); },
    hasMore: history.status === 'CanLoadMore',
    loadingHistory: history.status === 'LoadingMore',
    loadMore: () => history.loadMore(40),
  };
}
