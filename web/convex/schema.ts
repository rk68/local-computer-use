import { defineSchema, defineTable } from 'convex/server';
import { avatarAppearance } from './avatarOptions';
import { v } from 'convex/values';
export default defineSchema({
  screenshots: defineTable({ threadId: v.id('threads'), agentThreadId: v.string(), messageId: v.string(), order: v.optional(v.number()), id: v.string(), caption: v.string(), createdAt: v.number() }).index('by_thread', ['threadId']),
  runtimeControls: defineTable({ key: v.literal('model'), changing: v.boolean() }),
  bots: defineTable({ avatar: v.optional(avatarAppearance), name: v.string(), instructions: v.string(), memory: v.optional(v.string()), archived: v.optional(v.boolean()) }),
  threads: defineTable({
    botId: v.id('bots'), agentThreadId: v.string(), title: v.string(),
    updatedAt: v.number(), sandbox: v.optional(v.boolean()), sandboxPhase: v.optional(v.string()), activeRunId: v.optional(v.id('runs')),
    error: v.optional(v.string()), imported: v.optional(v.boolean()), archived: v.optional(v.boolean()),
  }).index('by_bot', ['botId']),
  runs: defineTable({
    threadId: v.id('threads'), kind: v.union(v.literal('text'), v.literal('desktop')),
    status: v.union(v.literal('queued'), v.literal('running'), v.literal('completed'), v.literal('failed'), v.literal('cancelled')),
    promptMessageId: v.optional(v.string()), prompt: v.optional(v.string()),
    command: v.optional(v.string()), body: v.optional(v.string()),
    createdAt: v.number(), error: v.optional(v.string()),
  }).index('by_thread', ['threadId']),
});
