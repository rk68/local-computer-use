import { useEffect, useId, useRef } from 'react';
import { avatarColours, defaultAvatar, type AvatarAppearance } from '../../shared/avatar';
import type { AgentMode } from './presence';

// One pointer listener for every avatar. Pointer movement never rerenders React.
const avatars = new Set<HTMLElement>();
let frame = 0;
let pointer = { x: -10000, y: -10000 };
function look() {
  frame = 0;
  const updates: [HTMLElement, number, number][] = [];
  for (const element of avatars) {
    const rect = element.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > innerHeight || rect.right < 0 || rect.left > innerWidth) continue;
    const dx = pointer.x - rect.left - rect.width / 2, dy = pointer.y - rect.top - rect.height / 2;
    const near = Math.hypot(dx, dy) < 280;
    const x = near ? Math.max(-1, Math.min(1, dx / 100)) : 0, y = near ? Math.max(-1, Math.min(1, dy / 100)) : 0;
    updates.push([element, x, y]);
  }
  for (const [element, x, y] of updates) { element.style.setProperty('--look-x', String(x)); element.style.setProperty('--look-y', String(y)); }
}
function move(event: PointerEvent) { pointer = { x: event.clientX, y: event.clientY }; if (!frame) frame = requestAnimationFrame(look); }
function leave() { pointer = { x: -10000, y: -10000 }; if (!frame) frame = requestAnimationFrame(look); }

// Halo is a soft, asymmetric pebble with two curious eyes.
export function HoloAvatar({ mode = 'idle', small = false, appearance = defaultAvatar }: { mode?: AgentMode; small?: boolean; appearance?: AvatarAppearance }) {
  const colours = avatarColours[appearance.colour];
  const body = appearance.style === 'orb' ? 'M41 28a17 17 0 1 1-34 0a17 17 0 1 1 34 0Z' : appearance.style === 'pixel' ? 'M16 14h17a8 8 0 0 1 8 8v13a8 8 0 0 1-8 8H16a8 8 0 0 1-8-8V22a8 8 0 0 1 8-8Z' : 'M25 13C35 12 42 20 41 30C40 40 31 45 21 42C11 40 6 33 8 24C10 16 16 14 25 13Z';
  const root = useRef<HTMLSpanElement>(null); const id = useId().replace(/:/g, '');
  useEffect(() => {
    const element = root.current;
    if (!element || matchMedia('(prefers-reduced-motion: reduce)').matches || !matchMedia('(pointer: fine)').matches) return;
    if (!avatars.size) { window.addEventListener('pointermove', move, { passive: true }); document.addEventListener('pointerleave', leave); }
    avatars.add(element);
    return () => { avatars.delete(element); if (!avatars.size) { window.removeEventListener('pointermove', move); document.removeEventListener('pointerleave', leave); cancelAnimationFrame(frame); frame = 0; } };
  }, []);
  return <span ref={root} className={`holo-avatar holo-avatar-3d ${small ? 'holo-avatar-small' : ''}`} data-mode={mode} data-colour={appearance.colour} data-style={appearance.style} aria-hidden="true">
    <span className="holo-character"><span className="holo-head"><svg viewBox="0 0 48 48" fill="none">
      <defs>
        <radialGradient id={`${id}-pearl`} cx=".32" cy=".23" r=".85"><stop stopColor={colours.light} /><stop offset=".42" stopColor={colours.body} /><stop offset=".78" stopColor={colours.shade} /><stop offset="1" stopColor={colours.shadow} /></radialGradient>
        <linearGradient id={`${id}-ring`} x1="10" y1="5" x2="36" y2="12" gradientUnits="userSpaceOnUse"><stop stopColor={colours.shade} /><stop offset=".4" stopColor={colours.light} /><stop offset="1" stopColor={colours.shadow} /></linearGradient>
      </defs>
      <ellipse className="holo-ground" cx="24" cy="44" rx="12" ry="2" fill="#000" opacity=".18" />
      <ellipse className="holo-halo" cx="24" cy="8" rx="10" ry="3" stroke={`url(#${id}-ring)`} strokeWidth="2.2" transform="rotate(-12 24 8)" />
      <path className="holo-face" d={body} fill={`url(#${id}-pearl)`} />
      <path d="M13 23c2-5 6-7 11-7" stroke="#fff" strokeWidth="1.5" opacity=".65" strokeLinecap="round" />
      <g className="holo-gaze"><g className="holo-eyes" fill="#24212e">
        <rect x="17" y="23" width="4.5" height="8" rx={appearance.style === 'pixel' ? 1 : 2.25} /><rect x="28" y="22" width="4.5" height="8" rx={appearance.style === 'pixel' ? 1 : 2.25} />
        <circle cx="18.5" cy="25" r=".8" fill="#fff" /><circle cx="29.5" cy="24" r=".8" fill="#fff" />
      </g></g>
    </svg></span></span>
  </span>;
}
