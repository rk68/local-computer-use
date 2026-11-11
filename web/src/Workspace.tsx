import { useEffect, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { z } from 'zod';
import { api } from '../convex/_generated/api';
import type { Id } from '../convex/_generated/dataModel';
import { localRequest } from './local-api';
import type { Navigation } from './components/BotThreads';

export function Workspace({ token, children }: { token: string; children: (navigation: Navigation) => React.ReactNode }) {
  const workspace = useQuery(api.workspace.list, { token });
  const bootstrap = useMutation(api.workspace.bootstrap);
  const importLegacy = useMutation(api.workspace.importLegacy);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState(() => {
    try { return localStorage.getItem('halo-selected-thread'); } catch { return null; }
  });
  useEffect(() => {
    void bootstrap({ token }).then(async threadId => {
      const legacy = await localRequest('/api/legacy-history', z.object({ messages: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string() })) }), token, {});
      await importLegacy({ token, threadId, messages: legacy.messages });
      setReady(true);
    }).catch(failure => setError(String(failure.message ?? failure)));
  }, [token, bootstrap, importLegacy]);
  if (error) return <div className="boot-state" role="alert">{error}</div>;
  if (!ready || !workspace?.threads.length) return <div className="boot-state">Opening your workspace…</div>;
  const thread = workspace.threads.find(t => t._id === selected) ?? workspace.threads[0];
  const bot = workspace.bots.find(b => b._id === thread.botId)!;
  function select(id: Id<'threads'>) {
    setSelected(id);
    try { localStorage.setItem('halo-selected-thread', id); } catch { /* Selection remains in memory. */ }
  }
  return children({ workspace, thread, bot, select });
}
