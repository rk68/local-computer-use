import type { AgentMode } from './presence';

// Halo is a soft, asymmetric pebble with two curious eyes.
export function HoloAvatar({ mode = 'idle', small = false }: { mode?: AgentMode; small?: boolean }) {
  return <span className={`holo-avatar ${small ? 'holo-avatar-small' : ''}`} data-mode={mode} aria-hidden="true">
    <span className="holo-character"><svg viewBox="0 0 48 48" fill="none">
      <ellipse className="holo-halo" cx="24" cy="7" rx="8" ry="2.5" stroke="currentColor" strokeWidth="1.3" />
      <path className="holo-face" d="M25 12C35 11 42 20 41 30C40 40 31 45 21 42C11 40 6 33 8 24C10 16 16 13 25 12Z" fill="currentColor" />
      <g className="holo-eyes" fill="var(--paper)">
        <rect x="17" y="23" width="4" height="8" rx="2" transform="rotate(-16 19 27)" />
        <rect x="28" y="21" width="4" height="8" rx="2" transform="rotate(-16 30 25)" />
      </g>
    </svg></span>
  </span>;
}
