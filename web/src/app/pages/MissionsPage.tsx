import { useEffect, useMemo, useState } from 'react'
import type { MissionInfo } from '@shared/protocol'
import { useApi } from '../../api/useApi'
import { C } from '../../lib/colors'
import { dockInput } from '../../shell/parts'
import { useYui } from '../../store/yui'
import { DeleteMissionModal, MissionView } from '../../views/MissionView'
import { Empty } from '../../views/ui'
import { Dot, openApp, relTime, Tag, useViewParams } from './common'

// Missões: planos de execução multi-agente. Lista à esquerda, plano (MissionView) à direita.

const STATUS: Record<MissionInfo['status'], [string, string]> = {
  running: ['rodando', C.cyan],
  paused: ['pausada', C.t2],
  blocked: ['precisa de você', C.warn],
  done: ['concluída', C.ok],
  failed: ['falhou', C.crit],
  cancelled: ['cancelada', C.t3],
}

function newMission() {
  useYui.getState().say('Qual é a missão? Descreva o objetivo e eu monto o plano com os agentes certos.')
  setTimeout(() => dockInput.el?.focus(), 30)
}

export function MissionsPage() {
  const id = useYui((s) => s.appParams.id)
  const live = useYui((s) => s.missions)
  const { data, reload } = useApi<MissionInfo[]>('/api/missions', [], 15000)
  const device = useYui((s) => s.device)
  const phone = device === 'phone'
  const [del, setDel] = useState<MissionInfo | null>(null)
  // no celular com missão aberta o cabeçalho é do MissionView (‹ Voltar + ações da missão)
  useEffect(() => {
    if (id && phone) return
    useYui.getState().setHeader({ eyebrow: 'Missões', title: 'Planos de execução', actions: [{ label: '+ Nova missão', fn: newMission, primary: true }] })
  }, [id, phone])
  const list = useMemo(() => {
    const m = new Map<string, MissionInfo>()
    for (const x of data ?? []) m.set(x.id, x)
    for (const x of Object.values(live)) m.set(x.id, x)
    return [...m.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }, [data, live])
  useViewParams(id ? { missionId: id } : {})

  // celular: missão aberta ocupa a tela toda (sem a lista)
  if (phone && id) return <MissionView />

  return (
    <div className="app-split" style={{ alignItems: 'flex-start' }}>
      <section style={{ width: id ? (device === 'tablet' ? 280 : 340) : '100%', maxWidth: '100%', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {list.length === 0 && <Empty text="Nenhuma missão ainda." hint="Peça algo grande para a Yui: “cria uma landing page para uma clínica”." />}
        {list.map((m) => {
          const [l, c] = STATUS[m.status]
          const done = m.steps.filter((s) => s.status === 'done').length
          const on = m.id === id
          return (
            <div key={m.id} style={{ position: 'relative' }}>
            <button
              onClick={() => openApp('missions', m.id)}
              className={on ? undefined : 'app-row'}
              style={{
                width: '100%', padding: phone ? '14px 34px 14px 14px' : '12px 48px 12px 14px', borderRadius: phone ? 16 : 14, minHeight: 44, textAlign: 'left', cursor: 'pointer', color: C.text, display: 'flex', flexDirection: 'column', gap: 8,
                background: on ? 'rgba(103,216,242,.07)' : phone ? 'rgba(255,255,255,.035)' : 'rgba(255,255,255,.025)', border: `1px solid ${on ? 'rgba(103,216,242,.25)' : phone ? 'rgba(255,255,255,.07)' : 'rgba(255,255,255,.06)'}`,
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                <Dot c={c} pulse={m.status === 'running'} />
                <span style={{ fontSize: 14, fontWeight: 600, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.title}</span>
                <span style={{ fontSize: 11.5, color: c }}>{l}</span>
              </span>
              <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {m.steps.map((s) => (
                  <Tag key={s.id} color={s.status === 'done' ? '#8af0cc' : s.status === 'running' ? '#a9e9f8' : s.status === 'failed' ? '#f6b3ba' : C.t2} bg={s.status === 'done' ? 'rgba(79,224,176,.12)' : s.status === 'running' ? 'rgba(103,216,242,.12)' : 'rgba(255,255,255,.05)'}>
                    {s.agent}
                  </Tag>
                ))}
              </span>
              <span className="app-muted">
                {done}/{m.steps.length} etapas{m.project ? ` · ${m.project}` : ''} · {relTime(m.createdAt)}
              </span>
              {phone && <span aria-hidden style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', fontSize: 22, color: C.t3 }}>›</span>}
            </button>
            {/* celular: excluir fica no ⋯ do detalhe */}
            {!phone && <button
              onClick={() => setDel(m)}
              aria-label={`Excluir missão ${m.title}`}
              title="Excluir missão"
              style={{ position: 'absolute', right: 8, bottom: 8, width: 32, height: 32, borderRadius: 9, border: '1px solid rgba(240,98,114,.25)', background: 'rgba(240,98,114,.06)', color: '#f39aa4', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" />
              </svg>
            </button>}
            </div>
          )
        })}
        {del && (
          <DeleteMissionModal
            mission={del}
            onClose={() => {
              setDel(null)
              reload()
            }}
          />
        )}
      </section>
      {id && (
        <section style={{ flex: 1, minWidth: 0, width: '100%', padding: '18px 20px', borderRadius: 18, background: 'linear-gradient(180deg, rgba(20,24,50,.62), rgba(12,14,32,.62))', border: '1px solid rgba(160,170,255,.11)' }}>
          <MissionView />
        </section>
      )}
    </div>
  )
}
