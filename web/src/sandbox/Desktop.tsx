import type { SandboxState } from './state';

type Props = {
  state: SandboxState;
  busy: boolean;
  command: (path: string) => Promise<boolean>;
  tryMission: () => void;
};

export function Desktop({ state, busy, command, tryMission }: Props) {
  const blocked = busy || state.pending !== null;
  return (
    <section className="desktop-panel panel" aria-label="Sandbox desktop">
      <div className="panel-heading">
        <div><span className="panel-icon">▧</span><h2>Sandbox desktop</h2><span id="phase" className="phase">{state.phase === 'idle' ? 'Not started' : state.phase}</span></div>
        <button id="refresh" className="icon-button" aria-label="Refresh screenshot" disabled={blocked || !state.sandbox} onClick={() => void command('/api/refresh')}>↻</button>
      </div>
      <div className="desktop" id="desktop">
        {state.screen ? <img id="screen" src={state.screen} alt="Latest screenshot of the Linux sandbox" /> : (
          <div id="empty-desktop">
            <div className="desktop-glyph" aria-hidden="true"><span /></div>
            <h3>Sandbox stopped</h3><p>Start an offline Linux VM for Holo to control.</p>
            <button id="start" className="primary" disabled={busy || state.sandbox} onClick={() => void command('/api/start')}>Start sandbox <span>↗</span></button>
            <div className="download-note">First start downloads the desktop image.</div>
          </div>
        )}
        {state.busy || state.phase === 'stopping' ? <div className="working"><span className="spinner" /><span>{state.phase}…</span></div> : null}
      </div>
      <div className="desktop-footer"><span><span className="dot" /> QEMU VM · guest network off</span><span id="step-count">{state.actions} / {state.max_actions} actions</span></div>
      <div className="practice">
        <div className="practice-icon" aria-hidden="true">✳</div>
        <div><strong>Practice task</strong><p>Change the name to Alex.</p></div>
        <button id="mission" className="text-button" disabled={blocked || !state.sandbox} onClick={tryMission}>Try it →</button>
      </div>
      <div className="activity">
        <div className="activity-label">SESSION ACTIVITY <span>{state.events.length}</span></div>
        <div id="events">{state.events.length ? [...state.events].reverse().map((event, index) => (
          <div className="event" key={`${index}-${event.time}`}><time>{event.time}</time><span>{event.text}</span></div>
        )) : <p className="muted">Sandbox activity will appear here.</p>}</div>
      </div>
    </section>
  );
}
