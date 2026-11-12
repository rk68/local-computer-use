import { saveMessages } from '@convex-dev/agent';
import { v } from 'convex/values';
import { internalMutation } from './_generated/server';
import { components } from './_generated/api';
const message = v.object({ role: v.union(v.literal('user'), v.literal('assistant'), v.literal('system')), text: v.string(), attachment: v.optional(v.object({ id: v.string(), caption: v.string(), createdAt: v.number() })) });
export const append = internalMutation({
  args: { runId: v.id('runs'), previous: v.array(message), current: v.array(message), sandbox: v.boolean(), phase: v.string() },
  handler: async (ctx, { runId, previous, current, sandbox, phase }) => {
    const run = await ctx.db.get(runId);
    const thread = run ? await ctx.db.get(run.threadId) : null;
    if (!thread || thread.activeRunId !== runId || run?.status !== 'running') return;
    await ctx.db.patch(thread._id, { sandbox, sandboxPhase: phase });
    let overlap = Math.min(previous.length, current.length);
    while (overlap && JSON.stringify(previous.slice(-overlap)) !== JSON.stringify(current.slice(0, overlap))) overlap--;
    const additions = current.slice(overlap).filter(m => m.role !== 'user');
    if (additions.length) {
      const saved = await saveMessages(ctx, components.agent, { threadId: thread.agentThreadId, messages: additions.map(m => ({ role: m.role as 'assistant' | 'system', content: m.text })) });
      for (let index = 0; index < additions.length; index++) {
        const attachment = additions[index].attachment;
        if (attachment && /^[a-f0-9]{32}$/.test(attachment.id)) await ctx.db.insert('screenshots', {
          threadId: thread._id, agentThreadId: thread.agentThreadId, messageId: saved.messages[index]._id, order: saved.messages[index].order, ...attachment,
        });
      }
    }
  },
});
