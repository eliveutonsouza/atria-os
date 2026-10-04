import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type WheelEvent } from 'react'
import type { BrowserClientMsg, BrowserServerMsg, BrowserTab } from '@shared/protocol'
import { api } from '../../api/client'
import { C, glow } from '../../lib/colors'
import { useYui } from '../../store/yui'
import { useHeader } from '../../views/ui'

// Navegador ao vivo: screencast do Chromium que os agentes usam (sidecar yui-browser, via CDP).
// Assistir é livre; mouse/teclado/URL só com "Assumir controle" ligado.

type Activity = Extract<BrowserServerMsg, { type: 'activity' }>
type Frame = Extract<BrowserServerMsg, { type: 'frame' }>

const btn: CSSProperties = { height: 28, padding: '0 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,.1)', background: 'transparent', color: '#dfe3f3', fontSize: 12, cursor: 'pointer' }
const iconBtn: CSSProperties = { width: 28, height: 28, borderRadius: 8, border: 'none', background: 'transparent', color: C.t2, cursor: 'pointer', fontSize: 15 }
const panel: CSSProperties = { padding: '14px 16px', borderRadius: 16, background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.06)' }

const hhmmss = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

export function BrowserPage() {
  const [tabs, setTabs] = useState<BrowserTab[]>([])
  const [frame, setFrame] = useState<Frame | null>(null)
  const [connected, setConnected] = useState(false)
  const [controlling, setControlling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activity, setActivity] = useState<Activity[]>([])
  const [fps, setFps] = useState(0)
  const [url, setUrl] = useState('')
  const [editingUrl, setEditingUrl] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const frames = useRef(0)
  const [now, setNow] = useState(Date.now())

  useHeader('Navegador · ao vivo', 'Assista os agentes navegando')

  // conexão com reconexão automática
  useEffect(() => {
    let closed = false
    let retry: ReturnType<typeof setTimeout> | undefined
    const open = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      const ws = new WebSocket(`${proto}://${location.host}/api/browser/live`)
      wsRef.current = ws
      ws.onmessage = (e) => {
        let m: BrowserServerMsg
        try {
          m = JSON.parse(e.data)
        } catch {
          return
        }
        if (m.type === 'frame') {
          frames.current++
          setFrame(m)
        } else if (m.type === 'tabs') setTabs(m.tabs)
        else if (m.type === 'status') {
          setConnected(m.connected)
          setControlling(m.controlling)
          setError(m.error ?? null)
        } else if (m.type === 'activity') setActivity((a) => [...a.slice(-39), m])
      }
      ws.onclose = () => {
        setConnected(false)
        if (!closed) retry = setTimeout(open, 2500)
      }
    }
    open()
    const t = setInterval(() => {
      setFps(frames.current)
      frames.current = 0
      setNow(Date.now())
    }, 1000)
    return () => {
      closed = true
      clearTimeout(retry)
      clearInterval(t)
      wsRef.current?.close()
    }
  }, [])

  const send = (m: BrowserClientMsg) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify(m))
  }
  const active = tabs.find((t) => t.active)
  useEffect(() => {
    if (!editingUrl) setUrl(active?.url ?? '')
  }, [active?.url, editingUrl])

  const last = activity[activity.length - 1]
  const busy = !!last && now - new Date(last.at).getTime() < 30_000
  const runActivity = last ? activity.filter((a) => a.runId === last.runId) : []

  // coordenadas da imagem exibida → viewport real do navegador
  const toPage = (e: MouseEvent | WheelEvent) => {
    const r = imgRef.current?.getBoundingClientRect()
    if (!r || !frame) return { x: 0, y: 0 }
    return { x: ((e.clientX - r.left) / r.width) * frame.width, y: ((e.clientY - r.top) / r.height) * frame.height }
  }
  const mouse = (event: 'mousePressed' | 'mouseReleased' | 'mouseMoved') => (e: MouseEvent) => {
    if (!controlling) return
    if (event === 'mouseMoved' && e.buttons === 0 && Math.random() > 0.35) return // menos tráfego
    e.preventDefault()
    send({ type: 'mouse', event, ...toPage(e), button: event === 'mouseMoved' ? 'none' : e.button === 2 ? 'right' : 'left', clickCount: event === 'mouseMoved' ? 0 : 1 })
  }
  const wheel = (e: WheelEvent) => {
    if (!controlling) return
    send({ type: 'mouse', event: 'mouseWheel', ...toPage(e), deltaX: e.deltaX, deltaY: e.deltaY })
  }
  const key = (event: 'keyDown' | 'keyUp') => (e: KeyboardEvent) => {
    if (!controlling) return
    e.preventDefault()
    e.stopPropagation() // Espaço/Esc não acionam atalhos do console enquanto controla o navegador
    send({ type: 'key', event, key: e.key, code: e.code, text: event === 'keyDown' && e.key.length === 1 ? e.key : event === 'keyDown' && e.key === 'Enter' ? '\r' : undefined })
  }

  const stopRun = async (runId: string) => {
    await api.post(`/api/runs/${runId}/cancel`).catch(() => {})
  }
  const narrow = useYui((s) => s.narrow)
  const openRun = (runId: string) => useYui.getState().set({ shellMode: 'app', appPage: 'runs', appParams: { id: runId } })

  const empty = connected && tabs.length === 0
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, height: narrow ? 'auto' : '100%', minHeight: narrow ? 0 : 560 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderRadius: 999, fontSize: 12, background: busy ? 'rgba(103,216,242,.08)' : 'rgba(255,255,255,.03)', border: `1px solid ${busy ? 'rgba(103,216,242,.25)' : 'rgba(255,255,255,.08)'}`, color: busy ? '#a9e9f8' : C.t2 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: !connected ? C.crit : busy ? C.cyan : C.t3, boxShadow: busy ? glow(C.cyan, 8) : undefined }} />
          {!connected ? 'Navegador desconectado' : busy ? `${last.agent} está usando · ${fps} fps` : `Ocioso · ${fps} fps`}
        </span>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#c9cde0', cursor: 'pointer', position: 'relative' }}>
          <input
            type="checkbox"
            checked={controlling}
            onChange={(e) => {
              setControlling(e.target.checked) // otimista; o servidor confirma via status
              send({ type: 'control', on: e.target.checked })
            }}
            style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }}
            aria-label="Assumir controle do navegador"
          />
          <span aria-hidden style={{ width: 36, height: 20, borderRadius: 10, background: controlling ? 'rgba(103,216,242,.45)' : 'rgba(255,255,255,.1)', position: 'relative', display: 'inline-block', transition: 'background .2s' }}>
            <span style={{ position: 'absolute', left: controlling ? 18 : 2, top: 2, width: 16, height: 16, borderRadius: '50%', background: controlling ? C.cyan : C.t2, transition: 'left .2s' }} />
          </span>
          Assumir controle
        </label>
      </div>

      <div style={{ display: 'flex', gap: 14, flex: 1, minHeight: 0, flexWrap: 'wrap' }}>
        <section style={{ flex: '999 1 560px', minWidth: 0, minHeight: narrow ? 0 : 420, display: 'flex', flexDirection: 'column', borderRadius: 16, overflow: 'hidden', border: `1px solid ${controlling ? 'rgba(103,216,242,.45)' : 'rgba(255,255,255,.1)'}`, background: '#14172c' }}>
          <div role="tablist" aria-label="Abas" style={{ display: 'flex', gap: 2, padding: '8px 10px 0', background: '#0f1226', overflowX: 'auto' }}>
            {tabs.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={t.active}
                onClick={() => send({ type: 'select', targetId: t.id })}
                title={t.url}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: '10px 10px 0 0', fontSize: 12, border: 'none', cursor: 'pointer', maxWidth: 220, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', background: t.active ? '#14172c' : 'transparent', color: t.active ? C.text : C.t3 }}
              >
                <span style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: t.active ? C.cyan : C.t4 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.title || 'Nova aba'}</span>
              </button>
            ))}
            {!tabs.length && <span style={{ padding: '8px 14px', fontSize: 12, color: C.t3 }}>sem abas</span>}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (controlling && url.trim()) send({ type: 'navigate', url })
              setEditingUrl(false)
            }}
            style={{ display: 'flex', alignItems: 'center', gap: narrow ? 6 : 10, flexWrap: narrow ? 'wrap' : 'nowrap', padding: '8px 12px', background: '#14172c', borderBottom: '1px solid rgba(255,255,255,.06)' }}
          >
            <button type="button" aria-label="Voltar" disabled={!controlling} onClick={() => send({ type: 'nav', action: 'back' })} style={{ ...iconBtn, opacity: controlling ? 1 : 0.4 }}>‹</button>
            <button type="button" aria-label="Avançar" disabled={!controlling} onClick={() => send({ type: 'nav', action: 'forward' })} style={{ ...iconBtn, opacity: controlling ? 1 : 0.4 }}>›</button>
            <button type="button" aria-label="Recarregar" disabled={!controlling} onClick={() => send({ type: 'nav', action: 'reload' })} style={{ ...iconBtn, opacity: controlling ? 1 : 0.4 }}>↻</button>
            <input
              aria-label="Endereço"
              value={url}
              readOnly={!controlling}
              onFocus={() => setEditingUrl(true)}
              onBlur={() => setEditingUrl(false)}
              onChange={(e) => setUrl(e.target.value)}
              className="mono"
              style={{ flex: 1, minWidth: 0, height: narrow ? 36 : 28, borderRadius: 8, border: 'none', outline: 'none', background: 'rgba(255,255,255,.05)', padding: '0 12px', fontSize: 12, color: '#c9cde0', order: narrow ? 10 : undefined, flexBasis: narrow ? '100%' : undefined }}
            />
            <button type="submit" disabled={!controlling} title={controlling ? 'Abrir endereço' : 'Ligue "Assumir controle" para navegar'} style={{ ...btn, opacity: controlling ? 1 : 0.45 }}>Abrir URL</button>
          </form>
          <div
            tabIndex={controlling ? 0 : -1}
            onKeyDown={key('keyDown')}
            onKeyUp={key('keyUp')}
            style={{ flex: narrow ? 'none' : 1, minHeight: 0, aspectRatio: narrow ? (frame ? `${frame.width} / ${frame.height}` : '16 / 10') : undefined, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0b0d1c', outline: 'none', cursor: controlling ? 'default' : 'not-allowed' }}
          >
            {frame && !empty ? (
              <img
                ref={imgRef}
                alt={`Tela do navegador: ${active?.title ?? ''}`}
                src={`data:image/jpeg;base64,${frame.data}`}
                draggable={false}
                onMouseDown={(e) => {
                  ;(e.currentTarget.parentElement as HTMLElement).focus()
                  mouse('mousePressed')(e)
                }}
                onMouseUp={mouse('mouseReleased')}
                onMouseMove={mouse('mouseMoved')}
                onWheel={wheel}
                onContextMenu={(e) => controlling && e.preventDefault()}
                style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', userSelect: 'none', display: 'block' }}
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center', padding: 24, color: C.t2 }}>
                <span aria-hidden style={{ width: 54, height: 54, borderRadius: '50%', background: 'radial-gradient(circle at 38% 34%, #fff, #67d8f2 32%, rgba(166,140,247,.75) 75%)', boxShadow: glow(C.cyan, 30), opacity: 0.85 }} />
                <span style={{ fontSize: 15, color: '#c9cde0' }}>{connected ? 'Nenhum agente navegando agora' : 'Conectando ao navegador dos agentes…'}</span>
                <span style={{ fontSize: 13, maxWidth: 360 }}>{connected ? 'Peça à Yui para testar um site — você assiste aqui em tempo real.' : 'Se demorar, o serviço yui-browser pode estar reiniciando.'}</span>
              </div>
            )}
            {controlling && frame && (
              <span style={{ position: 'absolute', top: 10, right: 12, padding: '4px 10px', borderRadius: 8, fontSize: 11, background: 'rgba(103,216,242,.18)', color: '#a9e9f8', border: '1px solid rgba(103,216,242,.35)' }}>
                Você está no controle
              </span>
            )}
          </div>
        </section>

        <aside style={{ flex: '1 1 300px', maxWidth: 360, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ ...panel, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, letterSpacing: '.16em', color: C.t3, fontWeight: 600 }}>EXECUÇÃO</span>
            {last ? (
              <>
                <button onClick={() => openRun(last.runId)} style={{ textAlign: 'left', border: 'none', background: 'transparent', padding: 0, color: C.text, fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                  {last.agent} · ver execução →
                </button>
                <span style={{ fontSize: 12, color: C.t2 }}>{busy ? 'usando o navegador agora' : `última ação às ${hhmmss(last.at)}`}</span>
              </>
            ) : (
              <span style={{ fontSize: 13, color: C.t2 }}>Nenhum agente usou o navegador ainda.</span>
            )}
          </div>
          <div className="mono" style={{ ...panel, flex: 1, minHeight: 200, background: 'rgba(0,0,0,.35)', display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12, overflowY: 'auto' }}>
            <span style={{ fontSize: 11, letterSpacing: '.16em', color: C.t3, fontWeight: 600, fontFamily: 'var(--sans)', marginBottom: 8 }}>AÇÕES DO AGENTE</span>
            {(runActivity.length ? runActivity : activity).slice(-20).map((a, i, arr) => (
              <div key={`${a.at}-${i}`} style={{ display: 'flex', gap: 10, padding: '4px 0', color: i === arr.length - 1 ? '#a9e9f8' : '#c9cde0' }}>
                <span style={{ color: C.t4, flexShrink: 0 }}>{hhmmss(a.at)}</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.action}</span>
              </div>
            ))}
            {!activity.length && <span style={{ color: C.t3, fontFamily: 'var(--sans)', fontSize: 12 }}>As ações aparecem aqui enquanto um agente navega.</span>}
          </div>
          {error && <div style={{ fontSize: 12, color: '#f6b3ba' }}>Não consegui executar: {error}</div>}
          {last && busy && (
            <button onClick={() => stopRun(last.runId)} style={{ height: 40, borderRadius: 12, border: '1px solid rgba(240,98,114,.35)', background: 'transparent', color: '#f39aa4', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              Parar agente
            </button>
          )}
        </aside>
      </div>
    </div>
  )
}
