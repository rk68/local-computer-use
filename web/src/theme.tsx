import { useState } from 'react';

type Theme = 'dark' | 'light';

function savedTheme(): Theme {
  try { return localStorage.getItem('holo-theme') === 'light' ? 'light' : 'dark'; }
  catch { return 'dark'; }
}

// Apply before mounting so the first app render uses the saved preference.
document.documentElement.dataset.theme = savedTheme();

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(savedTheme);
  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    setTheme(next);
    try { localStorage.setItem('holo-theme', next); } catch { /* Theme still works without storage. */ }
  }
  return <button className="theme-toggle icon-button" title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} onClick={toggle} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      {theme === 'dark' ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></> : <path d="M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z" />}
    </svg>
  </button>;
}
