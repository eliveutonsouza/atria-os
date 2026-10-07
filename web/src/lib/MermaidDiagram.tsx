import { useEffect, useState } from 'react'
import { C } from './colors'
import { renderMermaid } from './mermaid'

// Diagrama Mermaid renderizado (SVG sanitizado pela própria lib, securityLevel strict).
export function MermaidDiagram({ code, minHeight = 120 }: { code: string; minHeight?: number }) {
  const [svg, setSvg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    renderMermaid(code)
      .then((s) => {
        if (!alive) return
        setSvg(s)
        setErr(null)
      })
      .catch((e: Error) => alive && setErr(e.message.split('\n')[0]))
    return () => {
      alive = false
    }
  }, [code])
  if (err) return <div style={{ fontSize: 12, color: C.crit, padding: 8 }}>Diagrama inválido: {err}</div>
  if (!svg) return <div style={{ fontSize: 12, color: C.t3, padding: 8, minHeight }}>Desenhando…</div>
  return <div className="atria-mermaid" style={{ minHeight, overflow: 'auto' }} dangerouslySetInnerHTML={{ __html: svg }} />
}
