import { useMemo } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { z } from 'zod';

const chatCommand = z.object({ message: z.string().min(1).max(4000), desktop: z.boolean() });

export function useLocalChat(token: string, messages: UIMessage[], onFinish: () => void) {
  const transport = useMemo(() => new DefaultChatTransport<UIMessage>({
    api: '/api/conversation',
    headers: { 'X-Local-Token': token },
    prepareSendMessagesRequest({ messages: outgoing, body }) {
      const last = outgoing.at(-1);
      const message = last?.parts.flatMap(part => part.type === 'text' ? [part.text] : []).join('') ?? '';
      return { body: chatCommand.parse({ message, desktop: body?.desktop === true }) };
    },
  }), [token]);
  return useChat({ messages, transport, onFinish });
}
