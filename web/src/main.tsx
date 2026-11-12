import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { ConversationHistory } from './conversation/ConversationHistory';
import { useThreadChat } from './conversation/use-thread-chat';
import { ConvexProvider, ConvexReactClient, useMutation, useQuery } from 'convex/react';
import { api } from '../convex/_generated/api';
import { Workspace } from './Workspace';
import { BotThreads, type Navigation } from './components/BotThreads';
import { commandResponse, desktopCommandPath, desktopCommandBody, localRequest, modelResponse, sessionResponse } from './local-api';
import { PrivateLogin } from './sandbox/PrivateLogin';
import { Desktop } from './sandbox/Desktop';
import { actionDescription } from './sandbox/state';
import { playgroundState, type PlaygroundState } from './playground-state';
import { ThemeToggle } from './theme';
import { Notice } from './components/Notice';
import { HoloAvatar } from './agent/HoloAvatar';
import { AgentPresence } from './agent/AgentPresence';
import { agentMode } from './agent/presence';
import { Icon } from './components/Icon';
import { ModelPicker } from './components/ModelPicker';
import './web.css';

type ModelStatus = 'checking' | 'connected' | 'offline';
type BootData = { token: string; state: PlaygroundState; model: ModelStatus; convexUrl: string };

function App() {
  const [boot, setBoot] = useState<BootData>();
  const [failure, setFailure] = useState('');
  useEffect(() => {
    let closed = false;
    async function connect() {
      const { token, convex_url } = await localRequest('/api/session', sessionResponse);
      const [state, model] = await Promise.all([
        localRequest('/api/state', playgroundState, token),
        localRequest('/api/model', modelResponse, token),
      ]);
      if (!closed) setBoot({ token, state, model: model.ok ? 'connected' : 'offline', convexUrl: convex_url ?? 'http://127.0.0.1:3210' });
    }
    void connect().catch(error => { if (!closed) setFailure(String(error.message ?? error)); });
    return () => { closed = true; };
  }, []);
  const client = useMemo(() => boot ? new ConvexReactClient(boot.convexUrl) : null, [boot?.convexUrl]);
  useEffect(() => () => { void client?.close(); }, [client]);
  if (!boot || !client) return <div className="boot-state" role={failure ? 'alert' : 'status'}>{failure || 'Connecting to halo…'}</div>;
  return <ConvexProvider client={client}><Workspace token={boot.token}>{navigation => <ThreadSession key={navigation.thread._id} boot={boot} navigation={navigation} />}</Workspace></ConvexProvider>;
}

function ThreadSession({ boot, navigation }: { boot: BootData; navigation: Navigation }) {
  const [initial, setInitial] = useState<PlaygroundState>();
  const [error, setError] = useState('');
  useEffect(() => {
    let closed = false;
    void localRequest('/api/state', playgroundState, boot.token, undefined, navigation.thread._id).then(state => { if (!closed) setInitial(state); }).catch(failure => { if (!closed) setError(String(failure.message ?? failure)); });
    return () => { closed = true; };
  }, [boot.token, navigation.thread._id]);
  if (!initial) return <div className="boot-state" role={error ? 'alert' : 'status'}>{error || 'Opening thread…'}</div>;
  return <Playground {...boot} state={initial} navigation={navigation} />;
}

function Playground({ token, state: initialState, model: initialModel, navigation }: BootData & { navigation: Navigation }) {
  const { thread, bot } = navigation;
  const threadId = thread._id;
  const screenshots = useQuery(api.workspace.screenshots, { token, threadId });
  const desktopCommand = useMutation(api.runs.command);
  const clearHistory = useMutation(api.workspace.clear);
  const [state, setState] = useState(initialState);
  const [model, setModel] = useState(initialModel);
  const [draft, setDraft] = useState(() => { try { return sessionStorage.getItem(`halo-draft:${threadId}`) ?? ''; } catch { return ''; } });
  useEffect(() => { try { sessionStorage.setItem(`halo-draft:${threadId}`, draft); } catch { /* Keep the draft in memory. */ } }, [draft, threadId]);
  const [desktop, setDesktop] = useState(initialState.sandbox);
  const [error, setError] = useState('');
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState('');
  const [commandBusy, setCommandBusy] = useState(false);
  const [showDesktop, setShowDesktop] = useState(() => {
    try { return localStorage.getItem('holo-desktop-visible') === 'true'; }
    catch { return true; }
  });
  const latestRequest = useRef(0);
  const messageList = useRef<HTMLDivElement>(null);
  const lastMessage = useRef('');
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
  const refresh = useCallback(async () => {
    const requestId = ++latestRequest.current;
    try {
      const next = await localRequest('/api/state', playgroundState, token, undefined, threadId);
      if (latestRequest.current === requestId) {
        setState(next);
        setConnectionError('');
      }
    } catch (failure) {
      if (latestRequest.current === requestId) setConnectionError((failure as Error).message);
    }
  }, [token, threadId]);
  const chat = useThreadChat(token, threadId, thread.run, thread.error);
  const generating = chat.status === 'submitted' || chat.status === 'streaming';
  const busy = commandBusy || state.busy || state.phase === 'stopping'
    || generating || !!thread.activeRunId;
  const pending = state.pending;
  const presencePhase = state.busy ? state.phase : thread.run?.kind === 'text' ? thread.run.status === 'cancelled' ? 'stopping reply' : thread.run.status === 'queued' ? 'preparing reply' : 'generating text' : thread.run?.command === '/api/start' ? 'starting VM' : thread.run?.kind === 'desktop' ? 'thinking' : state.phase;
  const presence = agentMode({ ...state, busy, phase: presencePhase }, chat.status, desktop);
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
    const last = chat.messages.at(-1);
    const revision = last ? last.id + last.parts.flatMap(p => p.type === 'text' ? [p.text] : []).join('') : '';
    if (messageList.current && revision !== lastMessage.current) messageList.current.scrollTop = messageList.current.scrollHeight;
    lastMessage.current = revision;
  }, [chat.messages, presence]);

  async function command(path: string, body: object = {}) {
    setCommandBusy(true);
    setError('');
    setDismissedError(null);
    chat.clearError();
    try {
      if (['/api/login', '/api/forget-login', '/api/refresh', '/api/clear-chat'].includes(path)) {
        await localRequest(path, commandResponse, token, body, threadId);
        if (path === '/api/clear-chat') await clearHistory({ token, threadId });
      } else {
        await desktopCommand({ token, threadId, path: desktopCommandPath.parse(path), body: desktopCommandBody.parse(body) });
      }
      await refresh();
      return true;
    } catch (failure) {
      setError((failure as Error).message);
      return false;
    } finally {
      setCommandBusy(false);
    }
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || busy || pending || state.credential_request || model !== 'connected') return;
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
    await command('/api/clear-chat');
  }

  return <>
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="halo home">
        <span className="brand-orbit" aria-hidden="true"><img src="/brand/halo-symbol-white.svg" width="40" height="40" alt="" /></span>
        <img className="brand-logo brand-logo-dark" src="/brand/halo-lockup-white.svg" width="121" height="40" alt="halo" />
        <img className="brand-logo brand-logo-light" src="/brand/halo-lockup-black.svg" width="121" height="40" alt="halo" />
      </a>
      <BotThreads token={token} {...navigation} />
      <div className="sidebar-footer" aria-label="App controls"><ModelPicker token={token} busy={busy} onReady={ready => setModel(ready ? 'connected' : 'offline')} /><ThemeToggle /></div>
    </aside>
    <main>
      {visibleError && visibleError !== dismissedError ? <Notice message={visibleError} onDismiss={() => setDismissedError(visibleError)} /> : null}
      <div className="panels" data-desktop-visible={showDesktop}>
        <Desktop token={token} threadId={threadId} visible={showDesktop} onClose={() => setShowDesktop(false)} state={state} busy={busy} command={command} tryMission={() => { setDesktop(true); fillDraft(state.network ? 'Open https://example.com' : 'Change the name to Alex'); }} />
        <section className="chat-panel panel" aria-label="Chat">
          <div className="panel-heading"><div><HoloAvatar mode={presence} small appearance={bot.avatar} /><h2>Chat with {bot.name}</h2></div>
            <div className="chat-heading-actions">
              <button id="clear-chat" className="icon-button" title="Clear chat" aria-label="Clear chat" disabled={busy || pending !== null || state.credential_request !== null || !chat.messages.length} onClick={() => void clearChat()}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7m4-7v7" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
              <button id="toggle-desktop" className="icon-button" title={showDesktop ? 'Hide virtual desktop' : 'Show virtual desktop'} aria-label={showDesktop ? 'Hide virtual desktop' : 'Show virtual desktop'} aria-controls="desktop-sidebar" aria-expanded={showDesktop} onClick={() => setShowDesktop(visible => !visible)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M15 4v16" /><path d={showDesktop ? 'm9 9 3 3-3 3' : 'm11 9-3 3 3 3'} strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            </div>
          </div>
          <div className="messages" id="messages" role="log" aria-live="polite" ref={messageList}>
            {chat.hasMore ? <button className="history-more secondary" disabled={chat.loadingHistory} onClick={chat.loadMore}>{chat.loadingHistory ? 'Loading…' : 'Earlier messages'}</button> : null}
            {chat.messages.length ? <ConversationHistory messages={chat.messages} images={screenshots ?? []} token={token} threadId={threadId} botName={bot.name} avatar={bot.avatar} /> : <div className="chat-intro"><div className="welcome-character"><HoloAvatar appearance={bot.avatar} /></div><span className="welcome-eyebrow">MEET {bot.name.toUpperCase()}</span><h3>Put {bot.name} to work.</h3>
              <p>An extra pair of hands for the tabs, clicks, and little tasks between you and your next idea.</p>
              <div className="welcome-cards">
                <button className="welcome-card" onClick={() => { setDesktop(false); fillDraft('What can you help me with?'); }}><span className="card-symbol" aria-hidden="true">↗</span><strong>Start a conversation</strong><span>Think something through together.</span></button>
                <button className="welcome-card" disabled={!state.sandbox || busy} onClick={() => { setDesktop(true); fillDraft(state.network ? 'Open https://example.com' : 'Change the name to Alex'); }}><span className="card-symbol" aria-hidden="true">▧</span><strong>Try the desktop</strong><span>{state.sandbox ? 'Let Halo take the next step.' : 'Start the sandbox to get going.'}</span></button>
                <button className="welcome-card" onClick={() => { setDesktop(false); fillDraft('Explain how this local playground works.'); }}><span className="card-symbol" aria-hidden="true">⌘</span><strong>Get your bearings</strong><span>A quick tour of your workspace.</span></button>
              </div>
            </div>}
            <AgentPresence avatar={bot.avatar} mode={presence} desktop={desktop} phase={presencePhase} latestAction={[...state.events].reverse().find(event => event.text.startsWith("Proposed "))?.text} />
          </div>
          {state.credential_request ? <PrivateLogin key={state.credential_request.id} token={token} threadId={threadId} request={state.credential_request} busy={busy} command={command} /> : null}
          {pending ? <div id="proposal" className="proposal">
            <div className="proposal-label">YOUR APPROVAL NEEDED</div><p>{pending.action.reason}</p><pre>{actionDescription(pending.action)}</pre>
            <div className="approval-buttons">
              <button id="approve" className="primary" disabled={busy} onClick={() => void command('/api/approve', { id: pending.id })}>Approve one action</button>
              <button id="reject" className="secondary" disabled={busy} onClick={() => void command('/api/reject', { id: pending.id })}>Reject</button>
            </div><small>Expires after 2 minutes.</small>
          </div> : null}
          <div className="composer-area">
            <details className="chat-settings"><summary><span><Icon name="settings" /> Desktop controls</span><span>{desktop ? state.approve_all ? 'Auto approval' : 'Manual approval' : 'Text only'} <Icon name="chevron" /></span></summary><div className="settings-popover">
            <label className="mode"><input type="checkbox" id="desktop-mode" checked={desktop} disabled={busy || !state.sandbox} onChange={event => setDesktop(event.target.checked)} /><span>Include sandbox screenshot &amp; propose actions</span></label>
            <label className="mode"><input type="checkbox" id="approve-all" checked={state.approve_all} disabled={commandBusy || !state.sandbox || state.phase === 'stopping'} onChange={event => {
              const enabled = event.target.checked;
              setState(current => ({ ...current, approve_all: enabled }));
              void command('/api/approval-mode', { enabled }).then(ok => { if (!ok) void refresh(); });
            }} /><span>Approve all actions for me <small>· this sandbox session</small></span></label>
            </div></details>
            <form id="chat-form" onSubmit={event => void send(event)}>
              <label className="sr-only" htmlFor="message">Message {bot.name}</label>
              <textarea ref={input} id="message" rows={1} maxLength={4000} value={draft} disabled={pending !== null || state.credential_request !== null} onChange={event => setDraft(event.target.value)} placeholder={`Ask ${bot.name} a question, or give it a task…`} onKeyDown={event => {
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
                <button id="send" className="send" type="submit" aria-label="Send message" disabled={busy || pending !== null || state.credential_request !== null || !draft.trim() || model !== 'connected'}>↑</button>
              )}
            </form>
          </div>
        </section>
      </div>

    </main>
  </>;
}

createRoot(document.getElementById('root')!).render(<App />);
