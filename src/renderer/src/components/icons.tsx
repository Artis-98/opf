const s = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export const Icon = {
  logo: <svg width="18" height="18" viewBox="0 0 24 24" {...s} strokeWidth={2.2}><path d="M3 6h18M3 12h18M3 18h18" /><path d="M6 6v12M18 6v12" /></svg>,
  farm: <svg width="16" height="16" viewBox="0 0 24 24" {...s}><path d="M3 5h18M3 12h18M3 19h18" /><rect x="5" y="7" width="4" height="3" /><rect x="11" y="7" width="4" height="3" /><rect x="7" y="14" width="4" height="3" /></svg>,
  timeline: <svg width="16" height="16" viewBox="0 0 24 24" {...s}><path d="M3 6h9M7 12h11M5 18h8" /></svg>,
  prepare: <svg width="16" height="16" viewBox="0 0 24 24" {...s}><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" /></svg>,
  settings: <svg width="16" height="16" viewBox="0 0 24 24" {...s}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" /></svg>,
  theme: <svg width="16" height="16" viewBox="0 0 24 24" {...s}><circle cx="12" cy="12" r="4.5" /><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" /></svg>,
  up: <svg width="13" height="13" viewBox="0 0 24 24" {...s} strokeWidth={2.4}><path d="M6 15l6-6 6 6" /></svg>,
  down: <svg width="13" height="13" viewBox="0 0 24 24" {...s} strokeWidth={2.4}><path d="M6 9l6 6 6-6" /></svg>,
  x: <svg width="13" height="13" viewBox="0 0 24 24" {...s} strokeWidth={2.4}><path d="M6 6l12 12M18 6L6 18" /></svg>,
  plus: <svg width="14" height="14" viewBox="0 0 24 24" {...s} strokeWidth={2.4}><path d="M12 5v14M5 12h14" /></svg>,
  file: <svg width="16" height="16" viewBox="0 0 24 24" {...s}><path d="M14 3H6v18h12V7z" /><path d="M14 3v4h4M12 11v6M9 14l3 3 3-3" /></svg>,
  grid: <svg width="16" height="16" viewBox="0 0 24 24" {...s}><rect x="4" y="4" width="7" height="7" /><rect x="13" y="4" width="7" height="7" /><rect x="4" y="13" width="7" height="7" /><rect x="13" y="13" width="7" height="7" /></svg>,
  copy: <svg width="16" height="16" viewBox="0 0 24 24" {...s}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 012-2h8" /></svg>,
  rotate: <svg width="16" height="16" viewBox="0 0 24 24" {...s}><path d="M4 12a8 8 0 0114-5.3M20 12a8 8 0 01-14 5.3" /><path d="M18 3v4h-4M6 21v-4h4" /></svg>,
  trash: <svg width="16" height="16" viewBox="0 0 24 24" {...s}><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></svg>,
  printer: <svg width="14" height="14" viewBox="0 0 24 24" {...s}><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M7 15h10" /></svg>,
  spool: <svg width="14" height="14" viewBox="0 0 24 24" {...s}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="2.5" /></svg>,
  gear: <svg width="14" height="14" viewBox="0 0 24 24" {...s}><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2" /></svg>,
  edit: <svg width="14" height="14" viewBox="0 0 24 24" {...s}><path d="M4 20h4L19 9l-4-4L4 16v4z" /></svg>,
  warn: <svg width="13" height="13" viewBox="0 0 24 24" {...s}><path d="M12 3l10 18H2z" /><path d="M12 10v5M12 18v.5" /></svg>,
};
