import { useMemo } from 'react'
import type { MissionInfo } from '@shared/protocol'
import { useApi } from '../../api/useApi'
import { C } from '../../lib/colors'
import { dockInput } from '../../shell/parts'
import { useYui } from '../../store/yui'
import { MissionView } from '../../views/MissionView'
import { Empty, useHeader } from '../../views/ui'
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
  const { data } = useApi<MissionInfo[]>('/api/missions', [], 15000)
  useHeader('Missões', 'Planos de execução', [{ label: '+ Nova missão', fn: newMission }])
  const list = useMemo(() => {
    const m = new Map<string, MissionInfo>()
    for (const x of data ?? []) m.set(x.id, x)
    for (const x of Object.values(live)) m.set(x.id, x)
    return [...m.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }, [data, live])
  useViewParams(id ? { missionId: id } : {})

  return (
    <div className="app-split" style={{ alignItems: 'flex-start' }}>
      <section style={{ width: id ? 340 : '100%', maxWidth: '100%', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {list.length === 0 && <Empty text="Nenhuma missão ainda." hint="Peça algo grande para a Yui: “cria uma landing page para uma clínica”." />}
        {list.map((m) => {
          const [l, c] = STATUS[m.status]
          const done = m.steps.filter((s) => s.status === 'done').length
          const on = m.id === id
          return (
            <button
              key={m.id}
              onClick={() => openApp('missions', m.id)}
              className={on ? undefined : 'app-row'}
              style={{
                padding: '12px 14px', borderRadius: 14, textAlign: 'left', cursor: 'pointer', color: C.text, display: 'flex', flexDirection: 'column', gap: 8,
                background: on ? 'rgba(103,216,242,.07)' : 'rgba(255,255,255,.025)', border: `1px solid ${on ? 'rgba(103,216,242,.25)' : 'rgba(255,255,255,.06)'}`,
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
            </button>
          )
        })}
      </section>
      {id && (
        <section style={{ flex: 1, minWidth: 0, width: '100%', padding: '18px 20px', borderRadius: 18, background: 'linear-gradient(180deg, rgba(20,24,50,.62), rgba(12,14,32,.62))', border: '1px solid rgba(160,170,255,.11)' }}>
          <MissionView />
        </section>
      )}
    </div>
  )
}
