import type { UIMessage } from 'ai';
import { z } from 'zod';

export const transcriptMessage = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  text: z.string(),
});

export function toChatMessages(transcript: z.infer<typeof transcriptMessage>[]): UIMessage[] {
  return transcript.map((message, index) => ({
    id: `saved-${index}`,
    role: message.role,
    parts: [{ type: 'text', text: message.text }],
  }));
}
