'use node';
import { v } from 'convex/values';
import { internalAction } from './_generated/server';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';

export type Transcript = { role: 'user' | 'assistant' | 'system'; text: string }[];
export async function bridge(threadId: Id<'threads'>, path: string, body?: object) {
  const response = await fetch('http://127.0.0.1:8765' + path, {
    method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(60000),
    headers: { 'Content-Type': 'application/json', 'X-Local-Token': process.env.HALO_SESSION_TOKEN!, 'X-Halo-Thread': threadId },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? 'Local executor request failed.');
  return value;
}
export const start = internalAction({
  args: { runId: v.id('runs') }, handler: async (ctx, { runId }): Promise<void> => {
    if (!await ctx.runMutation(internal.runs.markRunning, { runId })) return;
    const { run, thread, history, bot } = await ctx.runQuery(internal.workspace.runContext, { runId });
    try {
      let state = await bridge(thread._id, '/api/state');
      if (run.command === '/api/chat') {
        state = await bridge(thread._id, '/api/thread-context', { instructions: bot?.instructions ?? '', messages: history.slice(0, -1) });
      }
      const seen: Transcript = state.messages.map((m: Transcript[number]) => ({ role: m.role, text: m.text }));
      await bridge(thread._id, run.command!, JSON.parse(run.body ?? '{}'));
      await ctx.scheduler.runAfter(250, internal.executor.monitor, { runId, seen, attempts: 0 });
    } catch (error) {
      await ctx.runMutation(internal.workspace.finish, { runId, error: error instanceof Error ? error.message : 'Local executor failed. The command was not retried.' });
    }
  },
});
export const monitor = internalAction({
  args: { runId: v.id('runs'), seen: v.array(v.object({ role: v.union(v.literal('user'), v.literal('assistant'), v.literal('system')), text: v.string() })), attempts: v.number() },
  handler: async (ctx, { runId, seen, attempts }): Promise<void> => {
    const { run, thread } = await ctx.runQuery(internal.workspace.runContext, { runId });
    if (thread.activeRunId !== runId || run.status !== 'running') return;
    try {
      const state = await bridge(thread._id, '/api/state');
      const current: Transcript = state.messages.map((m: Transcript[number]) => ({ role: m.role, text: m.text }));
      await ctx.runMutation(internal.desktopHistory.append, { runId, previous: seen.map(m => ({ role: m.role, text: m.text })), current, sandbox: state.sandbox, phase: state.phase });
      if (!state.busy) {
        await ctx.runMutation(internal.workspace.finish, { runId, ...(state.error ? { error: state.error } : {}) });
      } else if (attempts >= 600) {
        await bridge(thread._id, '/api/stop', {});
        await ctx.runMutation(internal.workspace.finish, { runId, error: 'The desktop run timed out. Its sandbox was stopped.' });
      } else {
        await ctx.scheduler.runAfter(1000, internal.executor.monitor, { runId, seen: current, attempts: attempts + 1 });
      }
    } catch {
      await ctx.runMutation(internal.workspace.finish, { runId, error: 'The local executor disconnected. The command was not retried. Inspect the desktop before continuing.' });
    }
  },
});
