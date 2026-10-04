import type { CSSProperties } from 'react'

// Estilos compartilhados pelo universo e pela Constelação (vidro escuro do layout).

export const glass: CSSProperties = {
  borderRadius: 18,
  background: 'rgba(12,14,32,0.78)',
  border: '1px solid rgba(160,170,255,0.16)',
  boxShadow: '0 20px 60px rgba(0,0,0,0.45)',
  backdropFilter: 'blur(10px)',
  WebkitBackdropFilter: 'blur(10px)',
}

export const eyebrow: CSSProperties = { fontSize: 10.5, letterSpacing: '.16em', textTransform: 'uppercase', fontWeight: 700 }
export const mono: CSSProperties = { fontFamily: "'JetBrains Mono', monospace" }

export const SPACE_BG =
  'radial-gradient(38% 34% at 28% 30%, rgba(166,140,247,0.15), rgba(0,0,0,0) 70%), radial-gradient(34% 30% at 62% 74%, rgba(103,216,242,0.11), rgba(0,0,0,0) 70%), radial-gradient(120% 90% at 60% 10%, #0f1533 0%, #0a0c1d 45%, #05060c 100%)'

export const Icon = {
  plus: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>,
  minus: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M5 12h14" /></svg>,
  center: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><circle cx="12" cy="12" r="3" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /></svg>,
  search: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>,
  menu: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>,
  close: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>,
}

export const primaryBtn: CSSProperties = {
  height: 40, padding: '0 14px', borderRadius: 11, border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg, #67d8f2, #a68cf7)', color: '#0a0c1d', fontSize: 13, fontWeight: 700,
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
}
export const ghostBtn: CSSProperties = {
  height: 40, padding: '0 14px', borderRadius: 11, cursor: 'pointer', border: '1px solid rgba(160,170,255,0.22)', background: 'transparent', color: '#dfe3f3', fontSize: 13, fontWeight: 600,
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
}
