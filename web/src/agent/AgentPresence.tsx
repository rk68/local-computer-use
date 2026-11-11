import { HoloAvatar } from './HoloAvatar';
import { agentLabels, type AgentMode } from './presence';

export function AgentPresence({ mode, desktop }: { mode: AgentMode; desktop: boolean }) {
  if (mode === 'idle') return null;
  const detail = mode === 'thinking' ? desktop ? 'Reading the screen and planning the next step' : 'Working through your request'
    : mode === 'executing' ? 'Sending the approved action to the sandbox'
    : mode === 'replying' ? 'Replying from your local model'
    : mode === 'waiting' ? 'Review the proposed action below'
    : mode === 'starting' ? 'Getting your isolated workspace ready'
    : 'Finishing up and removing the guest';
  return <div className="agent-presence" data-mode={mode} role="status" aria-live="polite" aria-atomic="true">
    <HoloAvatar mode={mode} />
    <div className="presence-copy"><div className="presence-title"><span className="presence-label">{agentLabels[mode]}</span>
      {mode === 'thinking' || mode === 'replying' ? <span className="thought-dots" aria-hidden="true"><i /><i /><i /></span>
        : mode === 'executing' ? <span className="action-bars" aria-hidden="true"><i /><i /><i /><i /></span> : null}
    </div><p>{detail}</p></div>
  </div>;
}
