import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import { C } from '../lib/colors'
import { confirmAction } from '../lib/feedback'
import { useYui } from '../store/yui'
import { BottomSheet } from '../views/Sheet'
import { ErrorNote } from '../views/ui'

// Cartão diário "Yui aprendeu" (canvas Atria — Yui aprendeu): o que a revisão em segundo plano propôs guardar —
// memória sobre o usuário e skills novas/atualizadas. Só entra o que for marcado; o resto é descartado.

interface Proposal {
  id: string
  kind: 'memory' | 'skill'
  agentName?: string | null
  createdAt: string
  memory?: { texto: string; motivo: string }
  skill?: { nome: string; descricao: string; corpo: string; diff: 'nova' | 'atualiza'; atual?: string }
}

// Diferença por linha (suficiente para SKILL.md curto): - removidas, + novas.
function lineDiff(a: string, b: string): { t: '+' | '-' | ' '; s: string }[] {
  const A = a.trim().split('\n')
  const B = b.trim().split('\n')
  const inA = new Set(A)
  const inB = new Set(B)
  return [...A.filter((l) => !inB.has(l)).map((s) => ({ t: '-' as const, s })), ...B.map((s) => ({ t: inA.has(s) ? (' ' as const) : ('+' as const), s }))]
}

const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function LearningModal() {
  const open = useYui((s) => s.learningOpen)
  const phone = useYui((s) => s.device === 'phone')
  const [items, setItems] = useState<Proposal[] | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [shown, setShown] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [loadErr, setLoadErr] = useState(false)
  const load = useCallback(() => {
    setItems(null)
    setLoadErr(false)
    api
      .get<Proposal[]>('/api/learning/proposals')
      .then((list) => {
        setItems(list)
        setChecked(new Set(list.map((p) => p.id)))
        setShown(new Set())
      })
      .catch(() => setLoadErr(true))
  }, [])
  useEffect(() => {
    if (open) load()
  }, [open, load])
  if (!open) return null
  const close = () => useYui.getState().set({ learningOpen: false })
  const toggle = (set: Set<string>, id: string) => {
    const n = new Set(set)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    return n
  }
  const list = items ?? []
  const decide = async (approve: string[]) => {
    setBusy(true)
    try {
      const r = await api.post<{ approved: string[]; rejected: string[]; errors: string[] }>('/api/learning/decide', { approve, reject: list.map((p) => p.id).filter((id) => !approve.includes(id)) })
      const s = useYui.getState()
      if (r.errors.length) s.say(`Guardei ${r.approved.length}. Não deu: ${r.errors[0]}`, { state: 'warning' })
      else s.say(r.approved.length ? `Guardei ${r.approved.length === 1 ? 'isso' : `${r.approved.length} coisas`}.` : 'Descartei. Não guardei nada.', { state: 'success' })
      close()
    } catch {
      useYui.getState().say('Não consegui registrar agora. Tente de novo.', { state: 'warning' })
    } finally {
      setBusy(false)
    }
  }
  const discardAll = async () => {
    if (!(await confirmAction({ title: 'Descartar tudo?', text: `Nada do que a Yui propôs hoje será guardado (${list.length} ${list.length === 1 ? 'item' : 'itens'}).`, confirmLabel: 'Descartar tudo', danger: true }))) return
    void decide([])
  }
  const later = () => {
    void api.post(`/api/inbox/${encodeURIComponent(`learn:${today()}`)}/dismiss`).catch(() => {})
    close()
  }
  const memories = list.filter((p) => p.memory)
  const skills = list.filter((p) => p.skill)
  const n = list.filter((p) => checked.has(p.id)).length
  const tall = phone ? 48 : 44
  const box = { display: 'flex', gap: 12, alignItems: 'flex-start', padding: phone ? 14 : '12px 14px', borderRadius: 12, background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.07)', cursor: 'pointer' } as const
  const check = { width: phone ? 22 : 18, height: phone ? 22 : 18, margin: phone ? 0 : '2px 0 0', flexShrink: 0 } as const
  const label = { fontSize: 12, fontWeight: 600, color: C.t2 } as const
  const mono = { fontFamily: "'JetBrains Mono', monospace", color: '#a9e9f8' } as const

  const content = (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 11, letterSpacing: '.24em', color: C.lav, fontWeight: 700 }}>YUI APRENDEU · HOJE</span>
        <span id="ya-title" style={{ fontSize: phone ? 19 : 22, fontWeight: phone ? 500 : 400, lineHeight: 1.35 }}>Escolha o que eu devo guardar</span>
        {!phone && <span style={{ fontSize: 13, color: C.t2 }}>Só entra o que você marcar; o resto é descartado. Lições dos agentes já valem sozinhas e podem ser desfeitas na ficha de cada um.</span>}
      </div>
      {loadErr && <ErrorNote text="Não consegui buscar o que a Yui aprendeu." retry={load} />}
      {!items && !loadErr && <span style={{ fontSize: 13, color: C.t3 }}>Carregando…</span>}
      {items && !list.length && <span style={{ fontSize: 13, color: C.t3 }}>Nada para revisar agora.</span>}
      {memories.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={label}>Sobre você · memória da Yui</span>
          {memories.map((p) => (
            <label key={p.id} style={box}>
              <input type="checkbox" checked={checked.has(p.id)} onChange={() => setChecked(toggle(checked, p.id))} style={check} />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                <span style={{ fontSize: 14, overflowWrap: 'anywhere' }}>{p.memory!.texto}</span>
                <span style={{ fontSize: 12, color: C.t2 }}>{p.memory!.motivo}{p.agentName ? ` · ${p.agentName}` : ''}</span>
              </span>
            </label>
          ))}
        </div>
      )}
      {skills.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={label}>Skills · procedimentos que se repetem</span>
          {skills.map((p) => {
            const sk = p.skill!
            const open = shown.has(p.id)
            return (
              <div key={p.id} style={{ ...box, cursor: 'default', flexDirection: 'column', gap: 10 }}>
                <label style={{ display: 'flex', gap: 12, alignItems: 'flex-start', cursor: 'pointer', width: '100%' }}>
                  <input type="checkbox" checked={checked.has(p.id)} onChange={() => setChecked(toggle(checked, p.id))} style={check} />
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 14, overflowWrap: 'anywhere' }}>
                      <span style={mono}>{sk.nome}</span> · {sk.diff === 'nova' ? 'nova' : 'atualiza a sua'}{p.agentName ? ` · para o ${p.agentName}` : ''}
                    </span>
                    <span style={{ fontSize: 12, color: C.t2 }}>{sk.descricao}</span>
                  </span>
                </label>
                <button onClick={() => setShown(toggle(shown, p.id))} style={{ alignSelf: 'flex-start', minHeight: phone ? 44 : 28, padding: 0, border: 'none', background: 'transparent', color: C.cyan, fontSize: 13, cursor: 'pointer' }}>
                  {open ? 'Esconder' : sk.diff === 'nova' ? 'Ver texto da skill' : 'Ver mudanças'}
                </button>
                {open && (
                  <pre style={{ margin: 0, padding: '10px 12px', borderRadius: 10, background: 'rgba(0,0,0,.35)', font: "12px/1.6 'JetBrains Mono', monospace", color: '#c9cde0', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 240, overflowY: 'auto' }}>
                    {sk.diff === 'atualiza' && sk.atual
                      ? lineDiff(sk.atual, sk.corpo).map((l, i) => (
                          <div key={i} style={{ color: l.t === '+' ? C.ok : l.t === '-' ? '#f39aa4' : '#c9cde0' }}>
                            {l.t === ' ' ? '  ' : `${l.t} `}
                            {l.s}
                          </div>
                        ))
                      : sk.corpo}
                  </pre>
                )}
              </div>
            )
          })}
        </div>
      )}
      <div style={phone ? { display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 4 } : { display: 'flex', gap: 10, paddingTop: 4 }}>
        {phone ? (
          <>
            <button disabled={busy || !n} onClick={() => void decide(list.filter((p) => checked.has(p.id)).map((p) => p.id))} style={{ height: 52, borderRadius: 12, border: 'none', background: C.cyan, color: '#06221c', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
              {n ? `Guardar ${n} ${n === 1 ? 'marcada' : 'marcadas'}` : 'Marque o que guardar'}
            </button>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 10 }}>
              <button onClick={later} style={{ height: tall, borderRadius: 12, border: '1px solid rgba(255,255,255,.18)', background: 'transparent', color: '#dfe3f3', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Depois</button>
              <button disabled={busy || !list.length} onClick={() => void discardAll()} style={{ height: tall, borderRadius: 12, border: '1px solid rgba(240,98,114,.35)', background: 'transparent', color: '#f39aa4', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Descartar tudo</button>
            </div>
          </>
        ) : (
          <>
            <button onClick={later} style={{ flex: 1, height: tall, borderRadius: 12, border: '1px solid rgba(255,255,255,.18)', background: 'transparent', color: '#dfe3f3', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Depois</button>
            <button disabled={busy || !list.length} onClick={() => void discardAll()} style={{ flex: 1, height: tall, borderRadius: 12, border: '1px solid rgba(240,98,114,.35)', background: 'transparent', color: '#f39aa4', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Descartar tudo</button>
            <button disabled={busy || !n} onClick={() => void decide(list.filter((p) => checked.has(p.id)).map((p) => p.id))} style={{ flex: 1.4, height: tall, borderRadius: 12, border: 'none', background: C.cyan, color: '#06221c', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
              {n ? `Guardar ${n} ${n === 1 ? 'marcada' : 'marcadas'}` : 'Marque o que guardar'}
            </button>
          </>
        )}
      </div>
    </>
  )
  if (phone)
    return (
      <BottomSheet label="Yui aprendeu" onClose={close} tone="rgba(166,140,247,.35)" zIndex={59}>
        {content}
      </BottomSheet>
    )
  return (
    <>
      <div onClick={close} style={{ position: 'absolute', inset: 0, zIndex: 58, background: 'rgba(4,5,12,.6)', backdropFilter: 'blur(6px)' }} />
      <div role="dialog" aria-modal="true" aria-labelledby="ya-title" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 'min(640px,calc(100% - 32px))', maxHeight: 'calc(var(--vvh) - var(--sat) - var(--sab) - 32px)', overflowY: 'auto', overscrollBehavior: 'contain', boxSizing: 'border-box', zIndex: 59, padding: 28, borderRadius: 22, background: 'linear-gradient(180deg,rgba(26,22,52,.98),rgba(14,16,34,.98))', border: '1px solid rgba(166,140,247,.35)', boxShadow: '0 30px 90px rgba(0,0,0,.6)', display: 'flex', flexDirection: 'column', gap: 18 }}>
        {content}
      </div>
    </>
  )
}
