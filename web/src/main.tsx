import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { toChatMessages } from './conversation/messages';
import { useLocalChat } from './conversation/use-local-chat';
import { commandResponse, localRequest, modelResponse, sessionResponse } from './local-api';
import { PrivateLogin } from './sandbox/PrivateLogin';
import { Desktop } from './sandbox/Desktop';
import { actionDescription } from './sandbox/state';
import { playgroundState, type PlaygroundState } from './playground-state';
import { ThemeToggle } from './theme';
import { Notice } from './components/Notice';
import { HoloAvatar } from './agent/HoloAvatar';
import { AgentPresence } from './agent/AgentPresence';
import { agentMode } from './agent/presence';
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
  if (!boot) return <div className="boot-state" role={failure ? 'alert' : 'status'}>{failure || 'Connecting to halo…'}</div>;
  return <Playground {...boot} />;
}

function Playground({ token, state: initialState, model: initialModel }: BootData) {
  const [state, setState] = useState(initialState);
  const [model, setModel] = useState(initialModel);
  const [draft, setDraft] = useState('');
  const [desktop, setDesktop] = useState(initialState.sandbox);
  const [error, setError] = useState('');
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState('');
  const [commandBusy, setCommandBusy] = useState(false);
  const [showDesktop, setShowDesktop] = useState(() => {
    try { return localStorage.getItem('holo-desktop-visible') !== 'false'; }
    catch { return true; }
  });
  const latestRequest = useRef(0);
  const messageList = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const resizeComposer = useCallback(() => {
    const element = input.current;
    if (!element) return;
    element.style.height = 'auto';
    const limit = Math.min(160, window.innerHeight * .2);
    element.style.height = `${Math.min(element.scrollHeight, limit)}px`;
    element.style.overflowY = element.scrollHeight > limit ? 'auto' : 'hidden';
  }, []);
  useLayoutEffect(resizeComposer, [draft, showDesktop, resizeComposer]);
  useEffect(() => {
    window.addEventListener('resize', resizeComposer);
    return () => window.removeEventListener('resize', resizeComposer);
  }, [resizeComposer]);
  useEffect(() => {
    try { localStorage.setItem('holo-desktop-visible', String(showDesktop)); } catch { /* Keep the in-memory preference. */ }
  }, [showDesktop]);
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
  const presence = agentMode(state, chat.status, desktop);
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
  }, [chat.messages, presence]);
  const serverTranscript = JSON.stringify(state.messages);
  useEffect(() => {
    if (!generating && !state.busy) chat.setMessages(toChatMessages(state.messages));
  }, [serverTranscript, generating, state.busy, chat.setMessages]);

  async function command(path: string, body: object = {}) {
    setCommandBusy(true);
    setError('');
    setDismissedError(null);
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
    setDismissedError(null);
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
    if (!text || busy || pending || state.credential_request) return;
    setDraft('');
    setError('');
    setDismissedError(null);
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
      <a className="brand" href="/" aria-label="halo home">
        <img className="brand-logo brand-logo-dark" src="/brand/halo-lockup-white.svg" width="121" height="40" alt="halo" />
        <img className="brand-logo brand-logo-light" src="/brand/halo-lockup-black.svg" width="121" height="40" alt="halo" />
      </a>
      <button className="nav active agent-nav" onClick={() => input.current?.focus()}><HoloAvatar small /><span>Halo<small>Your local assistant</small></span></button>
      <div className="local-note"><span className="dot" /> Inference on your Mac</div>
    </aside>
    <main>
      <header><div className="breadcrumb">Workspace <span>/</span> Playground</div><div className="header-actions"><div className="private-pill">Local session</div><ThemeToggle /></div></header>
      <section className="heading">
        <div className="heading-copy"><h1>Your workspace</h1><p>A little help. Entirely local.</p></div>
        <div className="model-pill"><span className={`dot ${model === 'connected' ? 'on' : model === 'offline' ? 'off' : ''}`} />
          <span id="model-status">{model === 'checking' ? 'Checking Holo4…' : model === 'connected' ? 'Holo4 connected' : 'Holo4 offline'}</span>
          <button id="model-check" className="icon-button" aria-label="Check model connection" onClick={() => void checkModel()}>↻</button>
        </div>
      </section>
      {visibleError && visibleError !== dismissedError ? <Notice message={visibleError} onDismiss={() => setDismissedError(visibleError)} /> : null}
      <div className="panels" data-desktop-visible={showDesktop}>
        <Desktop token={token} visible={showDesktop} state={state} busy={busy} command={command} tryMission={() => { setDesktop(true); fillDraft(state.network ? 'Open https://example.com' : 'Change the name to Alex'); }} />
        <section className="chat-panel panel" aria-label="Chat">
          <div className="panel-heading"><div><HoloAvatar mode={presence} small /><h2>Chat with Halo</h2></div>
            <div className="chat-heading-actions">
              <button id="clear-chat" className="icon-button" title="Clear chat" aria-label="Clear chat" disabled={busy || pending !== null || state.credential_request !== null || !chat.messages.length} onClick={() => void clearChat()}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7m4-7v7" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
              <button id="toggle-desktop" className="icon-button" title={showDesktop ? 'Hide desktop sidebar' : 'Show desktop sidebar'} aria-label={showDesktop ? 'Hide desktop sidebar' : 'Show desktop sidebar'} aria-controls="desktop-sidebar" aria-expanded={showDesktop} onClick={() => setShowDesktop(visible => !visible)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M15 4v16" /><path d={showDesktop ? 'm9 9 3 3-3 3' : 'm11 9-3 3 3 3'} strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            </div>
          </div>
          <div className="messages" id="messages" role="log" aria-live="polite" ref={messageList}>
            {chat.messages.length ? chat.messages.map(message => (
              <div className={`message-row ${message.role}`} key={message.id}>
                {message.role === 'assistant' ? <HoloAvatar /> : null}
                <div className={`message ${message.role}`}>
                  <div className="message-label">{message.role === 'assistant' ? 'Halo' : message.role === 'user' ? 'You' : 'Playground'}</div>
                  {message.parts.map((part, index) => part.type === 'text' ? <p key={index}>{part.text}</p> : null)}
                </div>
              </div>
            )) : <div className="chat-intro"><div className="welcome-character"><HoloAvatar /></div><span className="welcome-eyebrow">MEET HALO</span><h3>A little less doing.<br />{' '}A little more done.</h3>
              <p>An extra pair of hands for the tabs, clicks, and little tasks between you and your next idea.</p>
              <div className="welcome-cards">
                <button className="welcome-card" onClick={() => { setDesktop(false); fillDraft('What can you help me with?'); }}><span className="card-symbol" aria-hidden="true">↗</span><strong>Start a conversation</strong><span>Think something through together.</span></button>
                <button className="welcome-card" disabled={!state.sandbox || busy} onClick={() => { setDesktop(true); fillDraft(state.network ? 'Open https://example.com' : 'Change the name to Alex'); }}><span className="card-symbol" aria-hidden="true">▧</span><strong>Try the desktop</strong><span>{state.sandbox ? 'Let Halo take the next step.' : 'Start the sandbox to get going.'}</span></button>
                <button className="welcome-card" onClick={() => { setDesktop(false); fillDraft('Explain how this local playground works.'); }}><span className="card-symbol" aria-hidden="true">⌘</span><strong>Get your bearings</strong><span>A quick tour of your workspace.</span></button>
              </div>
            </div>}
            <AgentPresence mode={presence} desktop={desktop} />
          </div>
          {state.credential_request ? <PrivateLogin key={state.credential_request.id} request={state.credential_request} busy={busy} command={command} /> : null}
          {pending ? <div id="proposal" className="proposal">
            <div className="proposal-label">YOUR APPROVAL NEEDED</div><p>{pending.action.reason}</p><pre>{actionDescription(pending.action)}</pre>
            <div className="approval-buttons">
              <button id="approve" className="primary" disabled={busy} onClick={() => void command('/api/approve', { id: pending.id })}>Approve one action</button>
              <button id="reject" className="secondary" disabled={busy} onClick={() => void command('/api/reject', { id: pending.id })}>Reject</button>
            </div><small>Expires after 2 minutes.</small>
          </div> : null}
          <div className="composer-area">
            <details className="chat-settings"><summary><span>⚙ &nbsp; Desktop controls</span><span>{desktop ? state.approve_all ? 'Auto approval' : 'Manual approval' : 'Text only'} ⌃</span></summary><div className="settings-popover">
            <label className="mode"><input type="checkbox" id="desktop-mode" checked={desktop} disabled={busy || !state.sandbox} onChange={event => setDesktop(event.target.checked)} /><span>Include sandbox screenshot &amp; propose actions</span></label>
            <label className="mode"><input type="checkbox" id="approve-all" checked={state.approve_all} disabled={commandBusy || !state.sandbox || state.phase === 'stopping'} onChange={event => {
              const enabled = event.target.checked;
              setState(current => ({ ...current, approve_all: enabled }));
              void command('/api/approval-mode', { enabled }).then(ok => { if (!ok) void refresh(); });
            }} /><span>Approve all actions for me <small>· this sandbox session</small></span></label>
            </div></details>
            <form id="chat-form" onSubmit={event => void send(event)}>
              <label className="sr-only" htmlFor="message">Message Halo</label>
              <textarea ref={input} id="message" rows={1} maxLength={4000} value={draft} disabled={pending !== null || state.credential_request !== null} onChange={event => setDraft(event.target.value)} placeholder="Ask Halo a question, or give it a task…" onKeyDown={event => {
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
                <button id="send" className="send" type="submit" aria-label="Send message" disabled={busy || pending !== null || state.credential_request !== null || !draft.trim()}>↑</button>
              )}
            </form>
          </div>
        </section>
      </div>
      <footer><button id="stop" className="stop" disabled={state.phase === 'stopping' || !state.sandbox && !state.busy && state.phase !== 'cleanup required'} onClick={() => void command('/api/stop')}>■ &nbsp; Stop &amp; remove sandbox</button></footer>
    </main>
  </>;
}

createRoot(document.getElementById('root')!).render(<App />);
