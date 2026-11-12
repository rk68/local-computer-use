import { avatarColours, defaultAvatar, type AvatarAppearance } from '../../shared/avatar';
import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';
import { HoloAvatar } from './HoloAvatar';
import { agentLabels, type AgentMode } from './presence';

export function AgentPresence({ mode, desktop, phase, latestAction, avatar }: { mode: AgentMode; desktop: boolean; phase: string; latestAction?: string; avatar?: AvatarAppearance }) {
  const palette = avatarColours[(avatar ?? defaultAvatar).colour];
  const accent = { '--presence-colour': palette.body, '--presence-deep': palette.shadow, '--presence-highlight': palette.light, '--presence-glow': palette.body + '55', '--presence-glow-light': palette.shade + '44' } as CSSProperties;
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    setElapsed(0);
    if (mode === 'idle' || mode === 'waiting') return;
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [mode, phase]);
  if (mode === 'idle') return null;
  const title = phase === 'verifying task' ? 'Checking the result' : phase === 'preparing reply' ? 'Preparing a reply' : phase === 'stopping reply' ? 'Stopping reply' : agentLabels[mode];
  const working = mode !== 'waiting';
  const detail = phase === 'stopping reply' ? 'Stopping this response'
    : phase === 'preparing reply' ? 'Getting your conversation ready'
    : phase === 'verifying task' ? 'Checking the current screen against your request'
    : mode === 'thinking' ? desktop ? 'Reading the screen and planning the next step' : 'Preparing your response'
    : mode === 'executing' ? 'Carrying out the approved sandbox action'
    : mode === 'replying' ? 'Preparing your response'
    : mode === 'waiting' ? 'Review the proposed action below'
    : mode === 'starting' ? 'Getting your isolated workspace ready'
    : 'Finishing up and removing the guest';
  return <div className="agent-presence" style={accent} data-colour={(avatar ?? defaultAvatar).colour} data-mode={mode} data-phase={phase} role="status" aria-live="polite">
    <HoloAvatar mode={mode} appearance={avatar} />
    <div className="presence-copy"><div className="presence-title"><span className="presence-label">{title}</span>
      {working ? <span className="thought-dots" aria-hidden="true"><i /><i /><i /></span> : null}
      <span className="presence-elapsed" aria-hidden="true">{elapsed > 0 ? elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s` : ''}</span>
    </div><p>{detail}</p>{mode === 'executing' && latestAction ? <small>{latestAction.replace(/^Proposed /, '').split(' · ')[0]}</small> : null}</div>
  </div>;
}
