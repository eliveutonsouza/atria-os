import { useState, type CSSProperties } from 'react'
import type { ReminderInfo, ReminderRepeat } from '@shared/protocol'
import { api } from '../../api/client'
import { useApi } from '../../api/useApi'
import { C } from '../../lib/colors'
import { toastErr, toastOk } from '../../lib/feedback'
import { useYui } from '../../store/yui'
import { ActionSheet, BottomSheet } from '../../views/Sheet'
import { ConfirmDeleteModal, Empty, ErrorNote, Skeleton, useHeader } from '../../views/ui'
import { Tag } from './common'

// Lembretes (Desktop-Lembretes.dc.html): abas Próximos/Enviados/Cancelados, lista com data relativa
// e painel de edição (à direita no desktop, folha inferior no celular). Horários no fuso de São Paulo.

type Tab = 'pending' | 'done' | 'cancelled'
const TABS: { id: Tab; label: string }[] = [
  { id: 'pending', label: 'Próximos' },
  { id: 'done', label: 'Enviados' },
  { id: 'cancelled', label: 'Cancelados' },
]
const REPEAT: { v: ReminderRepeat | ''; label: string; short: string }[] = [
  { v: '', label: 'Não repetir', short: '' },
  { v: 'diario', label: 'Todo dia', short: 'todo dia' },
  { v: 'dias_uteis', label: 'Dias úteis', short: 'dias úteis' },
  { v: 'semanal', label: 'Toda semana', short: 'toda semana' },
  { v: 'mensal', label: 'Todo mês', short: 'todo mês' },
]
const repeatShort = (r: ReminderRepeat | null) => REPEAT.find((x) => x.v === (r ?? ''))?.short ?? ''

const TZ = 'America/Sao_Paulo'
const DAY = 86400_000
// São Paulo não tem horário de verão desde 2019: offset fixo -03:00
const toIso = (date: string, time: string) => new Date(`${date}T${time}:00-03:00`).toISOString()
function localParts(iso: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]))
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` }
}
const dayKey = (ms: number) => localParts(new Date(ms).toISOString()).date

// "Hoje 15:00", "Amanhã 09:00", "sex 18:00", "12/10 09:00"
function whenLabel(iso: string) {
  const { date, time } = localParts(iso)
  const t = new Date(iso).getTime()
  const now = Date.now()
  if (date === dayKey(now)) return `Hoje ${time}`
  if (date === dayKey(now + DAY)) return `Amanhã ${time}`
  if (date === dayKey(now - DAY)) return `Ontem ${time}`
  if (t > now && t - now < 6 * DAY) return `${new Date(iso).toLocaleDateString('pt-BR', { timeZone: TZ, weekday: 'short' }).replace('.', '')} ${time}`
  return `${date.slice(8, 10)}/${date.slice(5, 7)} ${time}`
}
// "em 2 h", "em 3 dias", "há 1 dia"
function relLabel(iso: string) {
  const d = new Date(iso).getTime() - Date.now()
  const a = Math.abs(d)
  const txt = a < 3600_000 ? `${Math.max(1, Math.round(a / 60_000))} min` : a < DAY ? `${Math.round(a / 3600_000)} h` : `${Math.round(a / DAY)} ${Math.round(a / DAY) === 1 ? 'dia' : 'dias'}`
  return d >= 0 ? `em ${txt}` : `há ${txt}`
}

const lbl: CSSProperties = { fontSize: 12, color: C.t2, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }
const input: CSSProperties = { borderRadius: 12, border: '1px solid rgba(255,255,255,.1)', background: 'rgba(6,7,13,.6)', color: C.text, fontSize: 14, padding: '10px 12px', fontFamily: 'inherit', minWidth: 0, width: '100%', boxSizing: 'border-box', colorScheme: 'dark' }

type Draft = { id: string | null; text: string; date: string; time: string; repeat: ReminderRepeat | ''; missed?: boolean }

function newDraft(text = ''): Draft {
  const next = Math.ceil((Date.now() + 3600_000) / 3600_000) * 3600_000
  const { date, time } = localParts(new Date(next).toISOString())
  return { id: null, text, date, time, repeat: '' }
}
const draftOf = (r: ReminderInfo): Draft => ({ id: r.id, text: r.text, ...localParts(r.dueAt), repeat: r.repeat ?? '', missed: r.status === 'missed' })

function Editor({ draft, onChange, onClose, onSaved, onStop, phone }: { draft: Draft; onChange: (d: Draft) => void; onClose: () => void; onSaved: () => void; onStop?: () => void; phone: boolean }) {
  const [busy, setBusy] = useState(false)
  const save = () => {
    if (!draft.text.trim()) return useYui.getState().say('Escreva o que devo lembrar.')
    if (!draft.date || !draft.time) return useYui.getState().say('Escolha o dia e a hora.')
    const body = { text: draft.text, dueAt: toIso(draft.date, draft.time), repeat: draft.repeat || null }
    setBusy(true)
    ;(draft.id ? api.put(`/api/reminders/${draft.id}`, body) : api.post('/api/reminders', body))
      .then(onSaved)
      .catch((e: Error) => toastErr(e, 'Não salvei o lembrete'))
      .finally(() => setBusy(false))
  }
  const h = phone ? 46 : 38
  return (
    <>
      <b style={{ fontSize: 15 }}>{draft.id ? 'Editar lembrete' : 'Novo lembrete'}</b>
      {draft.missed && <div style={{ fontSize: 12.5, color: C.warn }}>Este lembrete foi perdido (o servidor estava fora do ar). Escolha um novo horário.</div>}
      <label style={lbl}>
        O que lembrar
        <input autoFocus={!phone} value={draft.text} maxLength={300} onChange={(e) => onChange({ ...draft, text: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && save()} placeholder="Ligar para o contador" style={input} />
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 10 }}>
        <label style={lbl}>
          Dia
          <input type="date" value={draft.date} onChange={(e) => onChange({ ...draft, date: e.target.value })} style={input} />
        </label>
        <label style={lbl}>
          Hora
          <input type="time" value={draft.time} onChange={(e) => onChange({ ...draft, time: e.target.value })} style={input} />
        </label>
      </div>
      <label style={lbl}>
        Repetir
        <select value={draft.repeat} onChange={(e) => onChange({ ...draft, repeat: e.target.value as Draft['repeat'] })} style={input}>
          {REPEAT.map((r) => (
            <option key={r.v} value={r.v}>{r.label}</option>
          ))}
        </select>
      </label>
      <div style={{ fontSize: 11.5, color: C.t3 }}>Horário de Brasília. Na hora, a Yui avisa por notificação no celular e fala se o painel estiver aberto.</div>
      {onStop && (
        <button className="vault-link-btn" style={{ alignSelf: 'flex-start', color: C.t2, minHeight: phone ? 44 : undefined }} onClick={onStop}>
          Parar de lembrar (vai para Cancelados)
        </button>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: phone ? 'repeat(2,minmax(0,1fr))' : 'auto auto', justifyContent: phone ? undefined : 'end', gap: 8, marginTop: 4 }}>
        <button className="app-btn" style={{ height: h }} disabled={busy} onClick={onClose}>Cancelar</button>
        <button className="app-btn primary" style={{ height: h }} disabled={busy} onClick={save}>{busy ? 'Salvando…' : 'Salvar'}</button>
      </div>
    </>
  )
}

export function RemindersPage() {
  const device = useYui((s) => s.device)
  const coarse = useYui((s) => s.coarse)
  const phone = device === 'phone'
  const [tab, setTab] = useState<Tab>('pending')
  const pending = useApi<ReminderInfo[]>('/api/reminders?status=pending', [], 30000)
  const other = useApi<ReminderInfo[]>(tab === 'pending' ? null : `/api/reminders?status=${tab}`, [tab], 60000)
  const list = tab === 'pending' ? pending : other
  const [draft, setDraft] = useState<Draft | null>(null)
  const [del, setDel] = useState<ReminderInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [menu, setMenu] = useState<ReminderInfo | null>(null)

  const reload = () => {
    pending.reload()
    if (tab !== 'pending') other.reload()
  }
  const openNew = (text = '') => setDraft(newDraft(text))
  useHeader('Organizar · lembretes', 'Lembretes', [{ label: '+ Novo lembrete', primary: true, fn: () => openNew() }])

  const stop = (r: { id: string }) =>
    api
      .post(`/api/reminders/${r.id}/cancel`)
      .then(() => {
        if (draft?.id === r.id) setDraft(null)
        reload()
        toastOk('Lembrete cancelado.')
      })
      .catch((e: Error) => toastErr(e, 'Não cancelei o lembrete'))
  const remove = () => {
    if (!del) return
    setBusy(true)
    api
      .del(`/api/reminders/${del.id}`)
      .then(() => {
        if (draft?.id === del.id) setDraft(null)
        setDel(null)
        reload()
      })
      .catch((e: Error) => toastErr(e, 'Não excluí o lembrete'))
      .finally(() => setBusy(false))
  }
  const editable = (r: ReminderInfo) => r.status === 'pending' || r.status === 'missed'
  const btnH = coarse ? 44 : 34

  const editor = draft && (
    <Editor
      key={draft.id ?? 'new'}
      draft={draft}
      onChange={setDraft}
      onClose={() => setDraft(null)}
      onSaved={() => {
        setDraft(null)
        if (tab !== 'pending') setTab('pending')
        reload()
      }}
      onStop={draft.id ? () => stop({ id: draft.id! }) : undefined}
      phone={phone}
    />
  )

  const rows = list.data ?? []
  const body =
    list.loading && !list.data ? (
      <Skeleton kpis={0} rows={4} />
    ) : list.error ? (
      <ErrorNote />
    ) : !rows.length ? (
      <Empty
        text={tab === 'pending' ? 'Nenhum lembrete agendado.' : tab === 'done' ? 'Nenhum lembrete enviado ainda.' : 'Nenhum lembrete cancelado.'}
        hint={tab === 'pending' ? 'Diga “me lembra amanhã às 9 de revisar os leads” ou use + Novo lembrete.' : undefined}
      />
    ) : (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rows.map((r) => {
          const on = draft?.id === r.id
          const rep = repeatShort(r.repeat)
          const shownAt = tab === 'done' && r.firedAt ? r.firedAt : r.dueAt
          const sub = r.status === 'missed' ? 'perdido' : tab === 'pending' ? (rep ? `${rep} · ${relLabel(r.dueAt)}` : relLabel(r.dueAt)) : tab === 'done' ? `enviado ${relLabel(shownAt)}` : rep || relLabel(r.dueAt)
          const when = (
            <div style={{ minWidth: 0 }}>
              <b style={{ fontSize: 14, color: r.status === 'missed' ? C.warn : C.text }}>{whenLabel(shownAt)}</b>
              <div style={{ fontSize: 12, color: r.status === 'missed' ? C.warn : C.t2 }}>{sub}</div>
            </div>
          )
          const text = (
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14.5, color: tab === 'cancelled' ? C.t2 : C.text, overflowWrap: 'anywhere', textDecoration: tab === 'cancelled' ? 'line-through' : undefined }}>{r.text}</div>
              {(rep || r.status === 'missed') && (
                <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                  {r.status === 'missed' && <Tag color="#f5c97a" bg="rgba(245,181,74,.1)">não disparou</Tag>}
                  {rep && <Tag>{rep}</Tag>}
                </div>
              )}
            </div>
          )
          const cls = `app-row${on ? ' on' : ''}`
          const rowStyle: CSSProperties = { padding: '14px 16px', borderRadius: 14, background: on ? 'rgba(103,216,242,.07)' : 'rgba(255,255,255,.035)', border: `1px solid ${on ? 'rgba(103,216,242,.3)' : 'rgba(255,255,255,.07)'}` }
          if (phone)
            return (
              <div key={r.id} className={cls} style={{ ...rowStyle, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <button onClick={() => (editable(r) ? setDraft(draftOf(r)) : setMenu(r))} style={{ flex: 1, minWidth: 0, background: 'none', border: 'none', color: 'inherit', textAlign: 'left', padding: 0, display: 'flex', flexDirection: 'column', gap: 6, cursor: 'pointer', fontFamily: 'inherit' }}>
                  {when}
                  {text}
                </button>
                <button aria-label={`Ações: ${r.text}`} className="app-btn" style={{ width: 44, height: 44, padding: 0, flexShrink: 0 }} onClick={() => setMenu(r)}>⋯</button>
              </div>
            )
          return (
            <div key={r.id} className={cls} style={{ ...rowStyle, display: 'grid', gridTemplateColumns: '120px minmax(0,1fr) auto', gap: 16, alignItems: 'center' }}>
              {when}
              {text}
              <div style={{ display: 'flex', gap: 6 }}>
                {editable(r) ? (
                  <button className="app-btn" style={{ height: btnH }} onClick={() => setDraft(draftOf(r))}>Editar</button>
                ) : (
                  <button className="app-btn" style={{ height: btnH }} title="Criar um lembrete novo com o mesmo texto" onClick={() => openNew(r.text)}>Reusar</button>
                )}
                <button className="app-btn danger" style={{ height: btnH }} onClick={() => setDel(r)}>Excluir</button>
              </div>
            </div>
          )
        })}
      </div>
    )

  const pendingCount = pending.data?.length ?? 0
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div role="tablist" aria-label="Lembretes" className="h-scroll" style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 12, background: 'rgba(255,255,255,.04)', alignSelf: phone ? 'stretch' : 'flex-start' }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            style={{ flex: phone ? 1 : undefined, minHeight: coarse ? 44 : 32, padding: '0 12px', borderRadius: 9, border: 'none', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', whiteSpace: 'nowrap', background: tab === t.id ? 'rgba(103,216,242,.14)' : 'transparent', color: tab === t.id ? '#fff' : C.t2 }}
          >
            {t.label}
            {t.id === 'pending' && pendingCount > 0 && <span style={{ marginLeft: 6, color: C.cyan }}>{pendingCount}</span>}
          </button>
        ))}
      </div>
      {phone ? (
        body
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: device === 'tablet' ? 'minmax(0,1fr) 300px' : 'minmax(0,1fr) 340px', gap: 16, alignItems: 'start' }}>
          {body}
          <aside aria-label={draft ? (draft.id ? 'Editar lembrete' : 'Novo lembrete') : 'Lembrete'} className="app-card" style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 18, position: 'sticky', top: 0 }}>
            {editor ?? (
              <>
                <b style={{ fontSize: 15 }}>Lembretes</b>
                <div style={{ fontSize: 13, color: C.t2, lineHeight: 1.55 }}>Escolha <b>Editar</b> num lembrete para mudar texto, dia, hora ou repetição — ou crie um novo.</div>
                <button className="app-btn primary" style={{ alignSelf: 'flex-start', height: 38 }} onClick={() => openNew()}>+ Novo lembrete</button>
              </>
            )}
          </aside>
        </div>
      )}
      {phone && editor && (
        <BottomSheet label={draft?.id ? 'Editar lembrete' : 'Novo lembrete'} onClose={() => setDraft(null)}>
          {editor}
        </BottomSheet>
      )}
      {menu && (
        <ActionSheet
          title={menu.text}
          onClose={() => setMenu(null)}
          actions={[
            ...(editable(menu) ? [{ label: 'Editar', fn: () => setDraft(draftOf(menu)) }, { label: 'Parar de lembrar', fn: () => stop(menu) }] : [{ label: 'Reusar (novo lembrete)', fn: () => openNew(menu.text) }]),
            { label: 'Excluir', danger: true, fn: () => setDel(menu) },
          ]}
        />
      )}
      {del && (
        <ConfirmDeleteModal
          title="Excluir lembrete?"
          text="O lembrete some da lista e não será mais avisado."
          rows={[
            { label: 'Lembrete', value: del.text },
            { label: 'Quando', value: `${whenLabel(del.dueAt)}${del.repeat ? ` · ${repeatShort(del.repeat)}` : ''}` },
          ]}
          busy={busy}
          onCancel={() => setDel(null)}
          onConfirm={remove}
        />
      )}
    </div>
  )
}
