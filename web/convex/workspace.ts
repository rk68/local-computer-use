import { createThread, listUIMessages, syncStreams, vStreamArgs, saveMessages, listMessages, abortStream } from '@convex-dev/agent';
import { paginationOptsValidator } from 'convex/server';
import { v, ConvexError } from 'convex/values';
import { mutation, query, internalQuery, internalMutation } from './_generated/server';
import { components } from './_generated/api';
import { authorize, requiredText } from './access';

export const bootstrap = mutation({
  args: { token: v.string() }, handler: async (ctx, { token }) => {
    authorize(token);
    const first = await ctx.db.query('threads').first();
    if (first) return first._id;
    const botId = await ctx.db.insert('bots', { name: 'Halo', instructions: '' });
    const agentThreadId = await createThread(ctx, components.agent, { title: 'Getting started' });
    return ctx.db.insert('threads', { botId, agentThreadId, title: 'Getting started', updatedAt: Date.now() });
  },
});
export const list = query({
  args: { token: v.string() }, handler: async (ctx, { token }) => {
    authorize(token);
    const bots = (await ctx.db.query('bots').collect()).filter(b => !b.archived);
    const threads = (await ctx.db.query('threads').collect()).filter(t => bots.some(b => b._id === t.botId));
    return { bots, threads: await Promise.all(threads.map(async t => ({ ...t, run: t.activeRunId ? await ctx.db.get(t.activeRunId) : null }))) };
  },
});
export const createBot = mutation({
  args: { token: v.string(), name: v.string(), instructions: v.string() }, handler: async (ctx, args) => {
    authorize(args.token);
    if ((await ctx.db.query('bots').collect()).filter(b => !b.archived).length >= 24) throw new ConvexError('This workspace already has 24 bots.');
    if (args.instructions.length > 4000) throw new ConvexError('Instructions must contain at most 4,000 characters.');
    const botId = await ctx.db.insert('bots', { name: requiredText(args.name, 'Bot name', 60), instructions: args.instructions.trim() });
    const agentThreadId = await createThread(ctx, components.agent, { title: 'New conversation' });
    return ctx.db.insert('threads', { botId, agentThreadId, title: 'New conversation', updatedAt: Date.now(), imported: true });
  },
});
export const createConversation = mutation({
  args: { token: v.string(), botId: v.id('bots'), title: v.string() }, handler: async (ctx, args) => {
    authorize(args.token);
    if (!await ctx.db.get(args.botId)) throw new ConvexError('Bot no longer exists.');
    if ((await ctx.db.query('threads').take(201)).length >= 200) throw new ConvexError('This workspace already has 200 threads.');
    const title = requiredText(args.title, 'Thread title', 100);
    const agentThreadId = await createThread(ctx, components.agent, { title });
    return ctx.db.insert('threads', { botId: args.botId, agentThreadId, title, updatedAt: Date.now(), imported: true });
  },
});
export const messages = query({
  args: { token: v.string(), threadId: v.id('threads'), paginationOpts: paginationOptsValidator, streamArgs: vStreamArgs },
  handler: async (ctx, { token, threadId, ...rest }) => {
    authorize(token);
    const thread = await ctx.db.get(threadId);
    if (!thread) throw new ConvexError('Thread no longer exists.');
    const args = { ...rest, threadId: thread.agentThreadId };
    const paginated = await listUIMessages(ctx, components.agent, args);
    return { ...paginated, streams: await syncStreams(ctx, components.agent, args) };
  },
});
export const importLegacy = mutation({
  args: { token: v.string(), threadId: v.id('threads'), messages: v.array(v.object({ role: v.union(v.literal('user'), v.literal('assistant')), text: v.string() })) },
  handler: async (ctx, args) => {
    authorize(args.token);
    const thread = await ctx.db.get(args.threadId);
    if (!thread || thread.imported) return;
    const existing = await listMessages(ctx, components.agent, { threadId: thread.agentThreadId, paginationOpts: { cursor: null, numItems: 1 } });
    if (!existing.page.length && args.messages.length) {
      await saveMessages(ctx, components.agent, { threadId: thread.agentThreadId, messages: args.messages.slice(-60).map(m => ({ role: m.role, content: m.text.slice(0, 20000) })) });
    }
    await ctx.db.patch(thread._id, { imported: true });
  },
});
export const clear = mutation({
  args: { token: v.string(), threadId: v.id('threads') }, handler: async (ctx, { token, threadId }) => {
    authorize(token);
    const thread = await ctx.db.get(threadId);
    if (!thread) throw new ConvexError('Thread no longer exists.');
    if (thread.activeRunId) throw new ConvexError('Stop the current run before clearing chat.');
    // Keep the sandbox. Start a fresh message history and delete the old history in batches.
    const agentThreadId = await createThread(ctx, components.agent, { title: thread.title });
    await ctx.db.patch(threadId, { agentThreadId, error: undefined });
    await ctx.scheduler.runAfter(0, components.agent.threads.deleteAllForThreadIdAsync, { threadId: thread.agentThreadId });
  },
});
export const runContext = internalQuery({
  args: { runId: v.id('runs') }, handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    if (!run) throw new Error('Run no longer exists.');
    const thread = await ctx.db.get(run.threadId);
    if (!thread) throw new Error('Thread no longer exists.');
    const bot = await ctx.db.get(thread.botId);
    const history = await listUIMessages(ctx, components.agent, { threadId: thread.agentThreadId, paginationOpts: { cursor: null, numItems: 12 } });
    return { run, thread, bot, history: history.page.sort((a, b) => a.order - b.order || a.stepOrder - b.stepOrder).map(m => ({ role: m.role, text: m.parts.flatMap(p => p.type === 'text' ? [p.text] : []).join('') })) };
  },
});
export const finish = internalMutation({
  args: { runId: v.id('runs'), error: v.optional(v.string()) }, handler: async (ctx, { runId, error }) => {
    const run = await ctx.db.get(runId);
    if (!run) return;
    if (run.status !== 'cancelled') await ctx.db.patch(runId, { status: error ? 'failed' : 'completed', error });
    const thread = await ctx.db.get(run.threadId);
    if (thread?.activeRunId === runId) await ctx.db.patch(thread._id, { activeRunId: undefined, error, updatedAt: Date.now() });
  },
});
export const cancel = mutation({
  args: { token: v.string(), threadId: v.id('threads') }, handler: async (ctx, { token, threadId }) => {
    authorize(token);
    const thread = await ctx.db.get(threadId);
    if (!thread?.activeRunId) return;
    const run = await ctx.db.get(thread.activeRunId);
    if (!run || run.kind !== 'text') throw new ConvexError('Use the sandbox Stop control for desktop runs.');
    if (run.promptMessageId) {
      const [prompt] = await ctx.runQuery(components.agent.messages.getMessagesByIds, { messageIds: [run.promptMessageId] });
      if (prompt) await abortStream(ctx, components.agent, { threadId: thread.agentThreadId, order: prompt.order, reason: 'Stopped by user' });
    }
    // Keep the run attached until the action exits, so a second reply cannot overlap.
    await ctx.db.patch(run._id, { status: 'cancelled' });
  },
});

export const updateBot = mutation({
  args: { token: v.string(), botId: v.id('bots'), name: v.string(), instructions: v.string(), archived: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    authorize(args.token);
    const bot = await ctx.db.get(args.botId);
    if (!bot) throw new ConvexError('Bot no longer exists.');
    if (args.instructions.length > 4000) throw new ConvexError('Instructions must contain at most 4,000 characters.');
    const threads = await ctx.db.query('threads').withIndex('by_bot', q => q.eq('botId', args.botId)).collect();
    if (threads.some(t => t.activeRunId)) throw new ConvexError('Stop this bot’s runs before editing it.');
    if (args.archived && threads.some(t => t.sandbox || t.sandboxPhase === 'cleanup required')) throw new ConvexError('Stop this bot’s sandboxes before archiving it.');
    if (args.archived && (await ctx.db.query('bots').collect()).filter(b => !b.archived).length <= 1) throw new ConvexError('Keep at least one bot in the workspace.');
    await ctx.db.patch(args.botId, { name: requiredText(args.name, 'Bot name', 60), instructions: args.instructions.trim(), ...(args.archived !== undefined ? { archived: args.archived } : {}) });
    return { accepted: true as const };
  },
});
