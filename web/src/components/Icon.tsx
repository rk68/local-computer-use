import type { SVGProps } from 'react';
const paths = {
  cpu: <><rect x="6" y="6" width="12" height="12" rx="2" /><path d="M9 1v5m6-5v5M9 18v5m6-5v5M1 9h5m-5 6h5m12-6h5m-5 6h5" /><rect x="10" y="10" width="4" height="4" rx=".5" /></>,
  camera: <><path d="M8 6 10 3h4l2 3h5v15H3V6h5Z" /><circle cx="12" cy="13" r="4" /></>,
  refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6 7a7 7 0 0 1 11.6-1L20 9M4 15l2.4 3A7 7 0 0 0 18 17" /></>,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  desktop: <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8m-4-4v4" /></>,
  expand: <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" />,
  arrow: <path d="M7 17 17 7M7 7h10v10" />,
  play: <path d="m9 5 11 7-11 7V5Z" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  activity: <path d="M3 12h4l3-8 4 16 3-8h4" />,
  download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4" /></>,
  file: <><path d="M14 3H5v18h14V8l-5-5Z" /><path d="M14 3v5h5M8 12h8m-8 4h6" /></>,
  settings: <><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="3" fill="var(--bg)" /><circle cx="15" cy="17" r="3" fill="var(--bg)" /></>,
  chevron: <path d="m6 9 6 6 6-6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="m5 12 4 4L19 6" />,
  archive: <><rect x="3" y="3" width="18" height="5" rx="1" /><path d="M5 8v13h14V8M9 12h6" /></>,
  edit: <><path d="m14 5 5 5M4 20l5-1L20 8a2 2 0 0 0-5-5L4 14v6Z" /></>,
  brain: <><path d="M9 4a3 3 0 0 0-5 3v2a3 3 0 0 0 0 6v2a3 3 0 0 0 5 3V4Zm6 0a3 3 0 0 1 5 3v2a3 3 0 0 1 0 6v2a3 3 0 0 1-5 3V4Z" /><path d="M4 9h3m-3 6h3m13-6h-3m3 6h-3" /></>,
} as const;
export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: keyof typeof paths }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]}</svg>;
}
