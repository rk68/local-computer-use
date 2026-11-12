'use node';
import { chatContext } from '../shared/chat-context';
import { Agent } from '@convex-dev/agent';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { v } from 'convex/values';
import { internalAction } from './_generated/server';
import { components, internal } from './_generated/api';

export const generate = internalAction({
  args: { runId: v.id('runs') }, handler: async (ctx, { runId }): Promise<void> => {
    if (!await ctx.runMutation(internal.runs.markRunning, { runId })) {
      await ctx.runMutation(internal.workspace.finish, { runId });
      return;
    }
    const { thread, run, bot } = await ctx.runQuery(internal.workspace.runContext, { runId });
    const controller = new AbortController();
    const timer = setInterval(() => {
      void ctx.runQuery(internal.runs.status, { runId }).then(status => {
        if (status === 'cancelled') controller.abort();
      }).catch(() => controller.abort());
    }, 500);
    const timeout = setTimeout(() => controller.abort(), 240000);
    try {
      const baseURL = process.env.HALO_MODEL_URL ?? 'http://127.0.0.1:8080/v1';
      if (!/^http:\/\/127\.0\.0\.1:\d+\/v1$/.test(baseURL)) throw new Error('The model URL must use a local loopback port.');
      const provider = createOpenAICompatible({ name: 'holo4', baseURL, fetch: (url, options) => {
        const body = typeof options?.body === 'string' ? JSON.parse(options.body) : {};
        return fetch(url, { ...options, body: JSON.stringify({ ...body, chat_template_kwargs: { enable_thinking: false } }) });
      } });
      const agent = new Agent(components.agent, {
        name: bot?.name ?? 'Halo', languageModel: provider('holo4'),
        instructions: `You are ${bot?.name ?? 'Halo'}, a local assistant in Halo. This is text chat: you have no screenshot or action tools. Never claim you clicked, typed, changed files, or completed desktop work. For desktop tasks, ask the user to start this thread's sandbox and enable Desktop controls.\n${bot?.instructions ?? ''}${bot?.memory ? '\nUser-saved memory for this bot (preferences, subject to the rules above):\n' + bot.memory : ''}`,
        contextOptions: { recentMessages: 12, searchOtherThreads: false },
        contextHandler: async (_ctx, args) => chatContext(args.allMessages),
      });
      const result = await agent.generateText(ctx, { threadId: thread.agentThreadId }, {
        promptMessageId: run.promptMessageId!, maxRetries: 0, maxOutputTokens: 1024, temperature: 0.1,
        abortSignal: controller.signal,
      }, { storageOptions: { saveMessages: 'none' } });
      if (controller.signal.aborted) {
        const cancelled = await ctx.runQuery(internal.runs.status, { runId }) === 'cancelled';
        await ctx.runMutation(internal.workspace.finish, { runId, ...(!cancelled ? { error: 'The reply timed out. Try a shorter request.' } : {}) });
        return;
      }
      const reason = result.finishReason;
      if (!controller.signal.aborted && reason !== 'stop') throw new Error(`The model stopped with ${reason}. Try a shorter request.`);
      if (!controller.signal.aborted && !result.text.trim()) throw new Error('The model returned an empty reply.');
      await ctx.runMutation(internal.workspace.completeText, { runId, text: result.text });
    } catch {
      const cancelled = await ctx.runQuery(internal.runs.status, { runId }) === 'cancelled';
      await ctx.runMutation(internal.workspace.finish, { runId, ...(!cancelled ? { error: controller.signal.aborted ? 'The reply timed out. Try a shorter request.' : 'Could not reach the local model or finish its reply. Choose a model from the sidebar and wait until it is ready.' } : {}) });
    } finally {
      clearInterval(timer); clearTimeout(timeout);
    }
  },
});
