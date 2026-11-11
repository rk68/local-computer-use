import { useMemo, useRef } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { z } from 'zod';

import { commandResponse, localRequest } from '../local-api';

const chatCommand = z.object({
  message: z.string().min(1).max(4000),
  desktop: z.boolean(),
  request_id: z.string().uuid(),
});

export function useLocalChat(token: string, messages: UIMessage[], onFinish: () => void) {
  const activeRequest = useRef<string | null>(null);
  const transport = useMemo(() => new DefaultChatTransport<UIMessage>({
    api: '/api/conversation',
    headers: { 'X-Local-Token': token },
    prepareSendMessagesRequest({ messages: outgoing, body }) {
      const last = outgoing.at(-1);
      const message = last?.parts.flatMap(part => part.type === 'text' ? [part.text] : []).join('') ?? '';
      const request_id = crypto.randomUUID();
      activeRequest.current = request_id;
      return { body: chatCommand.parse({ message, desktop: body?.desktop === true, request_id }) };
    },
  }), [token]);
  const chat = useChat({ messages, transport, onFinish: () => {
    activeRequest.current = null;
    onFinish();
  } });

  async function stopGeneration() {
    const request_id = activeRequest.current;
    try {
      await chat.stop();
      if (request_id) {
        await localRequest('/api/cancel-conversation', commandResponse, token, { request_id });
      }
    } finally {
      activeRequest.current = null;
      onFinish();
    }
  }

  return { ...chat, stopGeneration };
}
