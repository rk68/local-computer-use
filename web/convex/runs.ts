import { saveMessage } from '@convex-dev/agent';
import { v, ConvexError } from 'convex/values';
import { mutation, internalMutation, internalQuery } from './_generated/server';
import { components, internal } from './_generated/api';
import { authorize, requiredText } from './access';

export const send = mutation({
  args: { token: v.string(), threadId: v.id('threads'), text: v.string(), desktop: v.boolean() },
  handler: async (ctx, args) => {
    authorize(args.token);
    if ((await ctx.db.query('runtimeControls').first())?.changing) throw new ConvexError('Wait for the local model to finish loading or unloading.');
    const thread = await ctx.db.get(args.threadId);
    if (!thread) throw new ConvexError('Thread no longer exists.');
    const bot = await ctx.db.get(thread.botId);
    if (thread.archived || bot?.archived) throw new ConvexError('Restore this conversation before sending a message.');
    if (thread.activeRunId) throw new ConvexError('This thread is already working.');
    const text = requiredText(args.text, 'Message', 4000);
    const { messageId } = await saveMessage(ctx, components.agent, { threadId: thread.agentThreadId, prompt: text });
    const runId = await ctx.db.insert('runs', { threadId: thread._id, kind: args.desktop ? 'desktop' : 'text', status: 'queued', createdAt: Date.now(), prompt: text, promptMessageId: messageId,
      ...(args.desktop ? { command: '/api/chat', body: JSON.stringify({ message: text, desktop: true }) } : {}) });
    await ctx.db.patch(thread._id, { activeRunId: runId, error: undefined, updatedAt: Date.now() });
    await ctx.scheduler.runAfter(0, args.desktop ? internal.executor.start : internal.generation.generate, { runId });
    await ctx.scheduler.runAfter(args.desktop ? 900000 : 300000, internal.runs.recover, { runId });
    return runId;
  },
});
export const command = mutation({
  args: { token: v.string(), threadId: v.id('threads'), path: v.union(v.literal('/api/share-screenshot'), v.literal('/api/start'), v.literal('/api/stop'), v.literal('/api/refresh'), v.literal('/api/approve'), v.literal('/api/reject'), v.literal('/api/approval-mode'), v.literal('/api/cancel-login')),
    body: v.object({ id: v.optional(v.string()), network: v.optional(v.boolean()), enabled: v.optional(v.boolean()) }) },
  handler: async (ctx, args) => {
    authorize(args.token);
    const thread = await ctx.db.get(args.threadId);
    if (!thread) throw new ConvexError('Thread no longer exists.');
    const bot = await ctx.db.get(thread.botId);
    if ((thread.archived || bot?.archived) && args.path !== '/api/stop') throw new ConvexError('Restore this conversation before starting work.');
    if (thread.activeRunId && args.path !== '/api/stop') throw new ConvexError('This thread is already working.');
    if (thread.activeRunId) {
      const previous = await ctx.db.get(thread.activeRunId);
      if (previous?.kind === 'text') throw new ConvexError('Stop generating before stopping the desktop.');
      await ctx.db.patch(thread.activeRunId, { status: 'cancelled' });
    }
    const runId = await ctx.db.insert('runs', { threadId: thread._id, kind: 'desktop', status: 'queued', createdAt: Date.now(), command: args.path, body: JSON.stringify(args.body) });
    await ctx.db.patch(thread._id, { activeRunId: runId, error: undefined });
    await ctx.scheduler.runAfter(0, internal.executor.start, { runId });
    await ctx.scheduler.runAfter(900000, internal.runs.recover, { runId });
    return { accepted: true as const };
  },
});
export const markRunning = internalMutation({
  args: { runId: v.id('runs') }, handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    if (!run || run.status !== 'queued') return false;
    await ctx.db.patch(runId, { status: 'running' });
    return true;
  },
});
export const status = internalQuery({
  args: { runId: v.id('runs') }, handler: async (ctx, { runId }) => (await ctx.db.get(runId))?.status,
});

export const recover = internalMutation({
  args: { runId: v.id('runs') }, handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    if (!run) return;
    const thread = await ctx.db.get(run.threadId);
    if (thread?.activeRunId !== runId) return;
    const error = run.kind === 'text' ? 'Generation was interrupted or timed out. Send a new message to continue.' : 'The desktop run was interrupted or timed out. Inspect the desktop and use Stop before continuing.';
    await ctx.db.patch(runId, { status: 'failed', error });
    await ctx.db.patch(thread._id, { activeRunId: undefined, error });
  },
});
