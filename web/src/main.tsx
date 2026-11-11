import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { toChatMessages } from './conversation/messages';
import { useLocalChat } from './conversation/use-local-chat';
import { commandResponse, localRequest, modelResponse, sessionResponse } from './local-api';
import { Desktop } from './sandbox/Desktop';
import { actionDescription } from './sandbox/state';
import { playgroundState, type PlaygroundState } from './playground-state';
import { ThemeToggle } from './theme';
import './web.css';

type ModelStatus = 'checking' | 'connected' | 'offline';
type BootData = { token: string; state: PlaygroundState; model: ModelStatus };

function App() {
  const [boot, setBoot] = useState<BootData>();
  const [failure, setFailure] = useState('');
  useEffect(() => {
    let closed = false;
    async function connect() {
      const { token } = await localRequest('/api/session', sessionResponse);
      const [state, model] = await Promise.all([
        localRequest('/api/state', playgroundState, token),
        localRequest('/api/model', modelResponse, token),
      ]);
      if (!closed) setBoot({ token, state, model: model.ok ? 'connected' : 'offline' });
    }
    void connect().catch(error => { if (!closed) setFailure(String(error.message ?? error)); });
    return () => { closed = true; };
  }, []);
  if (!boot) return <div className="boot-state" role={failure ? 'alert' : 'status'}>{failure || 'Connecting to Holo Local…'}</div>;
  return <Playground {...boot} />;
}

function Playground({ token, state: initialState, model: initialModel }: BootData) {
  const [state, setState] = useState(initialState);
  const [model, setModel] = useState(initialModel);
  const [draft, setDraft] = useState('');
  const [desktop, setDesktop] = useState(initialState.sandbox);
  const [error, setError] = useState('');
  const [connectionError, setConnectionError] = useState('');
  const [commandBusy, setCommandBusy] = useState(false);
  const latestRequest = useRef(0);
  const messageList = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const initialMessages = useMemo(() => toChatMessages(initialState.messages), [initialState.messages]);
  const refresh = useCallback(async () => {
    const requestId = ++latestRequest.current;
    try {
      const next = await localRequest('/api/state', playgroundState, token);
      if (latestRequest.current === requestId) {
        setState(next);
        setConnectionError('');
      }
    } catch (failure) {
      if (latestRequest.current === requestId) setConnectionError((failure as Error).message);
    }
  }, [token]);
  const onFinish = useCallback(() => { void refresh(); }, [refresh]);
  const chat = useLocalChat(token, initialMessages, onFinish);
  const generating = chat.status === 'submitted' || chat.status === 'streaming';
  const busy = commandBusy || state.busy || state.phase === 'stopping'
    || generating;
  const pending = state.pending;
  const visibleError = error || connectionError || state.error || chat.error?.message;

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      await refresh();
      if (!stopped) timer = setTimeout(poll, 1500);
    }
    timer = setTimeout(poll, 1500);
    return () => { stopped = true; clearTimeout(timer); };
  }, [refresh]);
  useEffect(() => { setDesktop(state.sandbox); }, [state.sandbox, state.sandbox_id]);
  useEffect(() => {
    if (messageList.current) messageList.current.scrollTop = messageList.current.scrollHeight;
  }, [chat.messages]);
  const serverTranscript = JSON.stringify(state.messages);
  useEffect(() => {
    if (!generating && !state.busy) chat.setMessages(toChatMessages(state.messages));
  }, [serverTranscript, generating, state.busy, chat.setMessages]);

  async function command(path: string, body: object = {}) {
    setCommandBusy(true);
    setError('');
    chat.clearError();
    try {
      await localRequest(path, commandResponse, token, body);
      await refresh();
      return true;
    } catch (failure) {
      setError((failure as Error).message);
      return false;
    } finally {
      setCommandBusy(false);
    }
  }

  async function checkModel() {
    setModel('checking');
    try {
      const result = await localRequest('/api/model', modelResponse, token);
      setModel(result.ok ? 'connected' : 'offline');
      setError(result.error ?? '');
    } catch (failure) {
      setModel('offline');
      setError((failure as Error).message);
    }
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || busy || pending) return;
    setDraft('');
    setError('');
    chat.clearError();
    try {
      await chat.sendMessage({ text }, { body: { desktop } });
    } catch (failure) {
      setError((failure as Error).message);
    }
  }

  function fillDraft(text: string) {
    setDraft(text);
    input.current?.focus();
  }

  async function clearChat() {
    if (await command('/api/clear-chat')) chat.setMessages([]);
  }

  return <>
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="Holo Local home"><span className="mark">h<span>·</span></span><span>holo<span className="brand-light">local</span></span></a>
      <div className="nav active"><span className="nav-icon">▧</span> Playground</div>
      <div className="local-note"><span className="dot" /> Inference on your Mac</div>
    </aside>
    <main>
      <header><div className="breadcrumb">Workspace <span>/</span> Playground</div><div className="header-actions"><div className="private-pill">Local session</div><ThemeToggle /></div></header>
      <section className="heading">
        <div className="heading-copy"><h1>Playground</h1><p>A private workspace for your local model.</p></div>
        <div className="model-pill"><span className={`dot ${model === 'connected' ? 'on' : model === 'offline' ? 'off' : ''}`} />
          <span id="model-status">{model === 'checking' ? 'Checking Holo4…' : model === 'connected' ? 'Holo4 connected' : 'Holo4 offline'}</span>
          <button id="model-check" className="icon-button" aria-label="Check model connection" onClick={() => void checkModel()}>↻</button>
        </div>
      </section>
      {visibleError ? <div className="error" role="alert">{visibleError}</div> : null}
      <div className="panels">
        <Desktop state={state} busy={busy} command={command} tryMission={() => { setDesktop(true); fillDraft('Change the name to Alex'); }} />
        <section className="chat-panel panel" aria-label="Chat">
          <div className="panel-heading"><div><span className="avatar tiny">h</span><h2>Chat with Holo</h2></div>
            <button id="clear-chat" className="text-button" disabled={busy || pending !== null || !chat.messages.length} onClick={() => void clearChat()}>Clear chat</button>
          </div>
          <div className="messages" id="messages" role="log" aria-live="polite" ref={messageList}>
            {chat.messages.length ? chat.messages.map(message => (
              <div className={`message ${message.role}`} key={message.id}>
                <div className="message-label">{message.role === 'assistant' ? 'Holo' : message.role === 'user' ? 'You' : 'Playground'}</div>
                {message.parts.map((part, index) => part.type === 'text' ? <p key={index}>{part.text}</p> : null)}
              </div>
            )) : <div className="chat-intro"><span className="avatar">h<span>·</span></span><h3>What shall we try?</h3>
              <p>Ask a question or start the sandbox to try a desktop task.</p>
              <button className="suggestion" onClick={() => fillDraft('Explain how this playground works.')}>How does this work? ↗</button>
            </div>}
          </div>
          {pending ? <div id="proposal" className="proposal">
            <div className="proposal-label">YOUR APPROVAL NEEDED</div><p>{pending.action.reason}</p><pre>{actionDescription(pending.action)}</pre>
            <div className="approval-buttons">
              <button id="approve" className="primary" disabled={busy} onClick={() => void command('/api/approve', { id: pending.id })}>Approve one action</button>
              <button id="reject" className="secondary" disabled={busy} onClick={() => void command('/api/reject', { id: pending.id })}>Reject</button>
            </div><small>Expires after 2 minutes.</small>
          </div> : null}
          <div className="composer-area">
            <label className="mode"><input type="checkbox" id="desktop-mode" checked={desktop} disabled={busy || !state.sandbox} onChange={event => setDesktop(event.target.checked)} /><span>Include sandbox screenshot &amp; propose actions</span></label>
            <label className="mode"><input type="checkbox" id="approve-all" checked={state.approve_all} disabled={commandBusy || !state.sandbox || state.phase === 'stopping'} onChange={event => {
              const enabled = event.target.checked;
              setState(current => ({ ...current, approve_all: enabled }));
              void command('/api/approval-mode', { enabled }).then(ok => { if (!ok) void refresh(); });
            }} /><span>Approve all actions for me <small>· this sandbox session</small></span></label>
            <form id="chat-form" onSubmit={event => void send(event)}>
              <label className="sr-only" htmlFor="message">Message Holo</label>
              <textarea ref={input} id="message" rows={2} maxLength={4000} value={draft} disabled={pending !== null} onChange={event => setDraft(event.target.value)} placeholder="Message Holo…" onKeyDown={event => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }} />
              {generating && !desktop ? (
                <button id="stop-generation" className="send" type="button" aria-label="Stop generating" onClick={() => {
                  void chat.stopGeneration().catch(failure => setError((failure as Error).message));
                }}>■</button>
              ) : (
                <button id="send" className="send" type="submit" aria-label="Send message" disabled={busy || pending !== null || !draft.trim()}>↑</button>
              )}
            </form>
            <div className="composer-footer"><span id="chat-status">{busy ? 'Working locally…' : pending ? 'Review the proposed action.' : desktop ? 'Desktop context · this VM' : 'Text chat · saved on this Mac'}</span><kbd>Enter ↵</kbd></div>
          </div>
        </section>
      </div>
      <footer><span>{state.approve_all ? 'Validated actions run automatically in this sandbox.' : 'Review each action before it runs.'}</span><button id="stop" className="stop" disabled={state.phase === 'stopping' || !state.sandbox && !state.busy && state.phase !== 'cleanup required'} onClick={() => void command('/api/stop')}>■ &nbsp; Stop &amp; remove sandbox</button></footer>
    </main>
  </>;
}

createRoot(document.getElementById('root')!).render(<App />);
