import { createThread, listUIMessages, syncStreams, vStreamArgs, saveMessages, saveMessage, listMessages, abortStream } from '@convex-dev/agent';
import { paginationOptsValidator } from 'convex/server';
import { v, ConvexError } from 'convex/values';
import { mutation, query, internalQuery, internalMutation } from './_generated/server';
import { components } from './_generated/api';
import { avatarAppearance } from './avatarOptions';
import { authorize, requiredText } from './access';

export const modelControl = mutation({
  args: { token: v.string(), changing: v.boolean() }, handler: async (ctx, { token, changing }) => {
    authorize(token);
    if (changing && (await ctx.db.query('threads').collect()).some(thread => thread.activeRunId)) throw new ConvexError('Wait for all bots to finish before switching models.');
    const current = await ctx.db.query('runtimeControls').first();
    if (current) await ctx.db.patch(current._id, { changing });
    else await ctx.db.insert('runtimeControls', { key: 'model', changing });
  },
});
export const syncExecutorState = mutation({
  args: { token: v.string(), threadId: v.id('threads'), sandbox: v.boolean(), phase: v.string() },
  handler: async (ctx, { token, threadId, sandbox, phase }) => {
    authorize(token);
    const thread = await ctx.db.get(threadId); if (!thread) return;
    const run = thread.activeRunId ? await ctx.db.get(thread.activeRunId) : null;
    const error = 'The desktop executor restarted. Inspect the sandbox and use Stop before continuing.';
    if (run?.kind === 'desktop') await ctx.db.patch(run._id, { status: 'failed', error });
    await ctx.db.patch(threadId, { sandbox, sandboxPhase: phase.slice(0, 40), ...(run?.kind === 'desktop' ? { activeRunId: undefined, error } : {}) });
  },
});

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
    const allBots = await ctx.db.query('bots').collect();
    const bots = allBots.filter(b => !b.archived);
    const allThreads = await ctx.db.query('threads').collect();
    const threads = allThreads.filter(t => !t.archived && bots.some(b => b._id === t.botId));
    return { bots, archivedBots: allBots.filter(b => b.archived), archivedThreads: allThreads.filter(t => t.archived && bots.some(b => b._id === t.botId)), threads: await Promise.all(threads.map(async t => ({ ...t, run: t.activeRunId ? await ctx.db.get(t.activeRunId) : null }))) };
  },
});
export const createBot = mutation({
  args: { token: v.string(), name: v.string(), instructions: v.string(), avatar: v.optional(avatarAppearance) }, handler: async (ctx, args) => {
    authorize(args.token);
    if ((await ctx.db.query('bots').collect()).filter(b => !b.archived).length >= 24) throw new ConvexError('This workspace already has 24 bots.');
    if (args.instructions.length > 4000) throw new ConvexError('Instructions must contain at most 4,000 characters.');
    const botId = await ctx.db.insert('bots', { name: requiredText(args.name, 'Bot name', 60), instructions: args.instructions.trim(), ...(args.avatar ? { avatar: args.avatar } : {}) });
    const agentThreadId = await createThread(ctx, components.agent, { title: 'New conversation' });
    return ctx.db.insert('threads', { botId, agentThreadId, title: 'New conversation', updatedAt: Date.now(), imported: true });
  },
});
export const createConversation = mutation({
  args: { token: v.string(), botId: v.id('bots'), title: v.string() }, handler: async (ctx, args) => {
    authorize(args.token);
    const bot = await ctx.db.get(args.botId);
    if (!bot || bot.archived) throw new ConvexError('Restore this bot before creating a thread.');
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
export const completeText = internalMutation({
  args: { runId: v.id('runs'), text: v.string() }, handler: async (ctx, { runId, text }) => {
    const run = await ctx.db.get(runId);
    const thread = run ? await ctx.db.get(run.threadId) : null;
    if (!run || run.kind !== 'text' || !thread || thread.activeRunId !== runId) return false;
    if (run.status !== 'running') {
      if (run.status === 'cancelled') await ctx.db.patch(thread._id, { activeRunId: undefined });
      return false;
    }
    await saveMessage(ctx, components.agent, { threadId: thread.agentThreadId, promptMessageId: run.promptMessageId,
      message: { role: 'assistant', content: text } });
    await ctx.db.patch(runId, { status: 'completed' });
    await ctx.db.patch(thread._id, { activeRunId: undefined, error: undefined, updatedAt: Date.now() });
    return true;
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
  args: { token: v.string(), botId: v.id('bots'), name: v.string(), instructions: v.string(), memory: v.optional(v.string()), avatar: v.optional(avatarAppearance), archived: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    authorize(args.token);
    const bot = await ctx.db.get(args.botId);
    if (!bot) throw new ConvexError('Bot no longer exists.');
    if (args.instructions.length > 4000) throw new ConvexError('Instructions must contain at most 4,000 characters.');
    if (args.memory !== undefined && args.memory.length > 2000) throw new ConvexError('Saved memory must contain at most 2,000 characters.');
    const threads = await ctx.db.query('threads').withIndex('by_bot', q => q.eq('botId', args.botId)).collect();
    if (threads.some(t => t.activeRunId)) throw new ConvexError('Stop this bot’s runs before editing it.');
    if (args.archived && threads.some(t => t.sandbox || t.sandboxPhase === 'cleanup required')) throw new ConvexError('Stop this bot’s sandboxes before archiving it.');
    if (args.archived && (await ctx.db.query('bots').collect()).filter(b => !b.archived).length <= 1) throw new ConvexError('Keep at least one bot in the workspace.');
    if (args.archived === false && bot.archived && (await ctx.db.query('bots').collect()).filter(b => !b.archived).length >= 24) throw new ConvexError('Archive another bot before restoring this one.');
    await ctx.db.patch(args.botId, { name: requiredText(args.name, 'Bot name', 60), instructions: args.instructions.trim(), ...(args.avatar ? { avatar: args.avatar } : {}), ...(args.memory !== undefined ? { memory: args.memory.trim() } : {}), ...(args.archived !== undefined ? { archived: args.archived } : {}) });
    return { accepted: true as const };
  },
});

export const updateThread = mutation({
  args: { token: v.string(), threadId: v.id('threads'), title: v.string(), archived: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    authorize(args.token);
    const thread = await ctx.db.get(args.threadId);
    if (!thread) throw new ConvexError('Thread no longer exists.');
    const bot = await ctx.db.get(thread.botId);
    if (!bot || bot.archived) throw new ConvexError('Restore this bot first.');
    if (thread.activeRunId) throw new ConvexError('Stop this thread’s run before editing it.');
    if (args.archived && (thread.sandbox || thread.sandboxPhase === 'cleanup required')) throw new ConvexError('Stop this thread’s sandbox before archiving it.');
    if (args.archived) {
      const siblings = await ctx.db.query('threads').withIndex('by_bot', q => q.eq('botId', thread.botId)).collect();
      if (siblings.filter(t => !t.archived).length <= 1) throw new ConvexError('Keep at least one active thread for this bot.');
    }
    await ctx.db.patch(args.threadId, { title: requiredText(args.title, 'Thread title', 100), updatedAt: Date.now(), ...(args.archived !== undefined ? { archived: args.archived } : {}) });
    return { accepted: true as const };
  },
});

export const screenshots = query({
  args: { token: v.string(), threadId: v.id('threads') },
  handler: async (ctx, { token, threadId }) => {
    authorize(token);
    const thread = await ctx.db.get(threadId);
    if (!thread) throw new ConvexError('Thread no longer exists.');
    return (await ctx.db.query('screenshots').withIndex('by_thread', q => q.eq('threadId', threadId)).collect()).filter(image => image.agentThreadId === thread.agentThreadId);
  },
});
