import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { localRequest } from '../local-api';
import type { SandboxState } from './state';

type Props = {
  visible: boolean;
  onClose: () => void;
  token: string;
  threadId: string;
  state: SandboxState;
  busy: boolean;
  command: (path: string, body?: object) => Promise<boolean>;
  tryMission: () => void;
};

export function Desktop({ visible, onClose, token, threadId, state, busy, command, tryMission }: Props) {
  const blocked = busy || state.pending !== null || state.credential_request !== null;
  const [expanded, setExpanded] = useState(false);
  const [network, setNetwork] = useState(false);
  const [downloads, setDownloads] = useState<{ name: string; size: number | null }[]>([]);
  const [downloadError, setDownloadError] = useState('');
  useEffect(() => { setDownloads([]); setDownloadError(''); }, [state.sandbox_id]);
  async function checkDownloads() {
    try {
      const result = await localRequest('/api/downloads', z.object({ files: z.array(z.object({ name: z.string(), size: z.number().nullable() })) }), token, {}, threadId);
      setDownloads(result.files); setDownloadError('');
    } catch (error) { setDownloadError((error as Error).message); }
  }
  const [activity, setActivity] = useState(false);
  const desktopDialog = useRef<HTMLDialogElement>(null);
  const activityDialog = useRef<HTMLDialogElement>(null);
  const latestCommand = useRef(command);
  useEffect(() => { latestCommand.current = command; }, [command]);
  useEffect(() => {
    if (expanded) desktopDialog.current?.showModal();
    else desktopDialog.current?.close();
  }, [expanded]);
  useEffect(() => {
    if (activity) activityDialog.current?.showModal();
    else activityDialog.current?.close();
  }, [activity]);
  // Observe the guest while expanded. Never race inference or change an approval's screenshot.
  useEffect(() => {
    if (!expanded || !state.sandbox || blocked) return;
    const timer = setTimeout(() => { void latestCommand.current('/api/refresh'); }, 2000);
    return () => clearTimeout(timer);
  }, [expanded, state.sandbox, blocked, state.screen]);

  return <>
    <section id="desktop-sidebar" className="desktop-panel panel" aria-label="Sandbox desktop" hidden={!visible}>
      <div className="panel-heading">
        <div><span className="panel-icon">▧</span><h2>Virtual desktop</h2><span id="phase" className="phase">{state.phase === 'idle' ? 'Not started' : state.phase}</span></div>
        <div className="desktop-heading-actions"><button id="refresh" className="icon-button" aria-label="Refresh screenshot" disabled={blocked || !state.sandbox} onClick={() => void command('/api/refresh')}>↻</button><button className="icon-button" aria-label="Close virtual desktop" onClick={onClose}>×</button></div>
      </div>
      <div className="desktop-frame">
        <div className="window-bar" aria-hidden="true"><span /><span /><span /><small>Linux sandbox</small></div>
        <div className="desktop" id="desktop">
          {state.screen ? <button className="screen-open" aria-label="Expand sandbox desktop" onClick={() => setExpanded(true)}>
            <img id="screen" src={state.screen} alt="Latest screenshot of the Linux sandbox" />
            <span className="expand-hint">⤢ <span>Expand desktop</span></span>
          </button> : <div id="empty-desktop">
            <div className="desktop-glyph" aria-hidden="true"><span /></div>
            <h3>A space to try things.</h3><p>A separate Linux desktop for Halo.</p>
            <label className="network-choice"><input type="checkbox" checked={network} disabled={busy} onChange={event => setNetwork(event.target.checked)} /> Enable web access · preview</label>
            {network ? <details className="network-details"><summary>Network access details</summary><p>This gives the VM outbound network access. Browser URL checks are not a firewall; private-network isolation is not guaranteed.</p></details> : null}
            <button id="start" className="primary" disabled={busy || state.sandbox} onClick={() => void command('/api/start', { network })}>Start sandbox <span>↗</span></button>
            <div className="download-note">{network ? 'Online browser · downloads stay in the VM.' : 'Offline practice · no internet access.'}</div>
          </div>}
          {state.busy || state.phase === 'stopping' ? <div className="working"><span className="spinner" /><span>{state.phase}…</span></div> : null}
        </div>
      </div>
      <div className="desktop-footer"><span><span className="dot" /> {state.network ? 'Browser · web access on' : 'Isolated · network off'}</span><span id="step-count">{state.actions} / {state.max_actions} actions</span></div>
      <div className="practice" hidden={state.network}>
        <div><strong>Try a small task</strong><p>Change the name to Alex.</p></div>
        <button id="mission" className="text-button" disabled={blocked || !state.sandbox} onClick={tryMission}>Try it ↗</button>
      </div>
      <button className="activity-toggle" onClick={() => setActivity(true)}><span>Session activity <span className="activity-count">{state.events.length}</span></span><span>↗</span></button>
      {state.network ? <div className="guest-downloads"><button className="text-button" disabled={blocked} onClick={() => void checkDownloads()}>Check guest downloads ↻</button>{downloads.map(file => <div className="guest-file" key={file.name}><span aria-hidden="true">▤</span><div><strong>{file.name}</strong><small>{file.size === null ? 'File in sandbox' : `${Math.ceil(file.size / 1024)} KB · in sandbox`}</small></div></div>)}{downloadError ? <p role="alert">{downloadError}</p> : null}</div> : null}
      <div className="desktop-caption">{state.network ? state.browser_origin || 'No website open yet.' : state.screen ? 'Click the preview to take a closer look.' : 'Your Mac stays separate from this workspace.'}</div>
      <div className="sandbox-stop"><button id="stop" className="stop" disabled={state.phase === 'stopping' || !state.sandbox && !busy && state.phase !== 'cleanup required'} onClick={() => void command('/api/stop')}>■ &nbsp; Stop &amp; remove sandbox</button></div>
    </section>
    <dialog ref={desktopDialog} className="desktop-dialog" aria-labelledby="desktop-title" onCancel={() => setExpanded(false)} onClose={() => setExpanded(false)}>
      <div className="dialog-heading"><div><h2 id="desktop-title">Sandbox desktop</h2><p>{state.pending || state.credential_request ? 'Paused for approval · screenshot held for review' : busy ? 'Working · updates after each action' : 'Live view · refreshes every 2 seconds'}</p></div><button className="dialog-close" aria-label="Close desktop" onClick={() => setExpanded(false)}>×</button></div>
      <div className="expanded-screen">{state.screen ? <img src={state.screen} alt="Expanded Linux sandbox desktop" /> : <p>Sandbox stopped.</p>}</div>
      <div className="dialog-footer"><span>View only · actions run through chat</span><button className="secondary" disabled={blocked || !state.sandbox} onClick={() => void command('/api/refresh')}>Refresh screenshot</button></div>
    </dialog>
    <dialog ref={activityDialog} className="activity-dialog" aria-labelledby="activity-title" onCancel={() => setActivity(false)} onClose={() => setActivity(false)}>
      <div className="dialog-heading"><div><h2 id="activity-title">Session activity</h2><p>Actions and updates from this sandbox.</p></div><button className="dialog-close" aria-label="Close activity" onClick={() => setActivity(false)}>×</button></div>
      <div id="events">{state.events.length ? [...state.events].reverse().map((event, index) => <div className="event" key={`${index}-${event.time}`}><time>{event.time}</time><span>{event.text}</span></div>) : <p className="muted">Sandbox activity will appear here.</p>}</div>
    </dialog>
  </>;
}
