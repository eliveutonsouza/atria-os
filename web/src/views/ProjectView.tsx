import { useState } from 'react'
import type { ProjectDetail, ProjectSummary } from '@shared/protocol'
import { api } from '../api/client'
import { useApi } from '../api/useApi'
import { startRun } from '../lib/actions'
import { C, toneColor } from '../lib/colors'
import { useYui, type HeaderAction } from '../store/yui'
import { Field, input } from './kit'
import { card, ConfirmDeleteModal, Empty, ErrorNote, Eyebrow, Skeleton, useHeader } from './ui'

// GET/PUT /api/projects/:slug/config (yui.json do projeto)
interface ProjectSettings {
  name?: string
  repo?: string
  healthUrl?: string
  container?: string
  preview?: string
  approvalPatterns?: string[]
}

export function ProjectView() {
  const slug = useYui((s) => s.viewParams.project ?? s.activeProject)
  const { data, loading, error, reload } = useApi<ProjectDetail>(slug ? `/api/projects/${encodeURIComponent(slug)}` : null, [], 20000)
  const [removing, setRemoving] = useState(false)
  const [editing, setEditing] = useState(false)
  const actions: HeaderAction[] = []
  if (data?.hasPreview) actions.push({ label: 'Live preview', fn: () => useYui.getState().show('website', { project: data.slug }) })
  if (data?.hasLogs) actions.push({ label: 'Ver logs', fn: () => useYui.getState().show('logs', { project: data.slug }) })
  if (data?.issue) actions.push({ label: 'Pedir correção', primary: true, fn: () => startRun('backend', data.slug, `Investigue e corrija o problema: ${data.issue}`) })
  if (data) {
    actions.push({ label: 'Configurar', fn: () => setEditing(true) })
    actions.push({ label: 'Remover do console', danger: true, fn: () => setRemoving(true) })
  }
  useHeader('Projeto', data?.name ?? slug ?? 'Projeto', actions, [data])
  if (!slug) return <Empty text="Nenhum projeto ativo." hint="Diga: “Abre o Stoqmate.”" />
  if (loading && !data) return <Skeleton rows={4} />
  if (error || !data) return <ErrorNote text="Não encontrei esse projeto." />
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22, maxWidth: 1100 }}>
      {data.issue && (
        <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', borderRadius: 14, background: 'rgba(245,181,74,.07)', border: '1px solid rgba(245,181,74,.25)', color: '#f5c97a', fontSize: 14 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: C.warn, boxShadow: `0 0 10px ${C.warn}`, flexShrink: 0 }} />
          <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{data.issue}</span>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 14 }}>
        {data.kpis.map((k) => (
          <div key={k.label} style={card}>
            <div style={{ fontSize: 12, color: C.t2, marginBottom: 8 }}>{k.label}</div>
            <div style={{ fontSize: 30, fontWeight: 300, letterSpacing: '-.02em', color: toneColor(k.tone) }}>{k.value}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <Eyebrow style={{ marginBottom: 8 }}>Atividade recente</Eyebrow>
        {data.activity.length === 0 && <Empty text="Ainda não há atividade neste projeto." />}
        {data.activity.map((ac, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '64px 14px minmax(0,1fr)', gap: 12, alignItems: 'center', padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,.05)', fontSize: 14 }}>
            <span className="mono" style={{ fontSize: 12, color: C.t3 }}>{ac.t}</span>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: toneColor(ac.tone) }} />
            <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{ac.label}</span>
          </div>
        ))}
      </div>
      <ProjectSettingsCard slug={data.slug} editing={editing} setEditing={setEditing} onSaved={reload} onRemove={() => setRemoving(true)} />
      {removing && <RemoveProject slug={data.slug} name={data.name} onClose={() => setRemoving(false)} />}
    </div>
  )
}

// Configuração do projeto = yui.json (saúde, container dos logs, preview e comandos que pedem aprovação).
function ProjectSettingsCard({ slug, editing, setEditing, onSaved, onRemove }: { slug: string; editing: boolean; setEditing: (v: boolean) => void; onSaved: () => void; onRemove: () => void }) {
  const phone = useYui((s) => s.device === 'phone')
  const cfg = useApi<ProjectSettings>(`/api/projects/${encodeURIComponent(slug)}/config`, [slug])
  const c = cfg.data
  const rows: [string, string][] = c
    ? [
        ['URL de saúde', c.healthUrl || '—'],
        ['Container dos logs', c.container || '—'],
        ['Pasta de preview', c.preview || '—'],
        ['Pedem aprovação', c.approvalPatterns?.length ? c.approvalPatterns.join(' · ') : 'nenhum comando extra'],
      ]
    : []
  return (
    <section style={{ ...card, display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <Eyebrow>Configuração do projeto</Eyebrow>
        {!editing && c && <button className="app-btn small" onClick={() => setEditing(true)}>Editar</button>}
      </div>
      {cfg.error && <span style={{ fontSize: 13, color: C.t3 }}>Este projeto ainda não está clonado no console.</span>}
      {!editing && c && (
        <div style={{ display: 'flex', flexDirection: 'column', fontSize: 13 }}>
          {rows.map(([k, v]) => (
            <div key={k} style={{ display: 'grid', gridTemplateColumns: phone ? 'minmax(0,1fr)' : '170px minmax(0,1fr)', gap: phone ? 2 : 12, padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,.05)' }}>
              <span style={{ color: C.t2 }}>{k}</span>
              <span className="app-mono" style={{ fontSize: 12, overflowWrap: 'anywhere', color: v === '—' ? C.t3 : C.text }}>{v}</span>
            </div>
          ))}
        </div>
      )}
      {editing && c && (
        <SettingsForm
          slug={slug}
          initial={c}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false)
            cfg.reload()
            onSaved()
          }}
        />
      )}
      {c && !editing && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', paddingTop: 4 }}>
          <span style={{ fontSize: 12, color: C.t3, flex: '1 1 220px' }}>Remover apaga só a cópia local na VPS. O repositório no GitHub não muda.</span>
          <button className="app-btn small danger" onClick={onRemove}>Remover do console</button>
        </div>
      )}
    </section>
  )
}

function SettingsForm({ slug, initial: c, onCancel, onSaved }: { slug: string; initial: ProjectSettings; onCancel: () => void; onSaved: () => void }) {
  const phone = useYui((s) => s.device === 'phone')
  const [form, setForm] = useState({ name: c.name ?? '', healthUrl: c.healthUrl ?? '', container: c.container ?? '', preview: c.preview ?? '', patterns: (c.approvalPatterns ?? []).join('\n') })
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    setErr(null)
    try {
      await api.put(`/api/projects/${encodeURIComponent(slug)}/config`, {
        name: form.name,
        healthUrl: form.healthUrl,
        container: form.container,
        preview: form.preview,
        approvalPatterns: form.patterns.split('\n').map((l) => l.trim()).filter(Boolean),
      })
      useYui.getState().say('Configuração do projeto salva.')
      onSaved()
    } catch (e) {
      setErr((e as Error).message)
      setSaving(false)
    }
  }

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value })
  return (
    <div style={{ display: 'grid', gridTemplateColumns: phone ? 'minmax(0,1fr)' : 'repeat(2,minmax(0,1fr))', gap: 12 }}>
      <Field label="Nome">
        <input style={input} value={form.name} onChange={set('name')} placeholder={slug} />
      </Field>
      <Field label="URL de saúde" hint="Testada a cada minuto; fora do ar vira alerta.">
        <input style={input} value={form.healthUrl} onChange={set('healthUrl')} placeholder="https://meusite.com/health" inputMode="url" />
      </Field>
      <Field label="Container dos logs" hint="Nome do container Docker.">
        <input style={input} value={form.container} onChange={set('container')} placeholder="meusite-api" />
      </Field>
      <Field label="Pasta de preview" hint="Relativa ao projeto, com index.html.">
        <input style={input} value={form.preview} onChange={set('preview')} placeholder="dist" />
      </Field>
      <div style={{ gridColumn: '1 / -1' }}>
        <Field label="Comandos que pedem aprovação" hint="Um por linha. Se o comando do agente contiver o texto, você aprova antes.">
          <textarea style={{ ...input, minHeight: 84, resize: 'vertical' }} value={form.patterns} onChange={set('patterns')} placeholder={'npm run deploy\ngit push'} />
        </Field>
      </div>
      {err && <div style={{ gridColumn: '1 / -1', fontSize: 13, color: C.crit }}>{err}</div>}
      <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: phone ? 'repeat(2,minmax(0,1fr))' : 'auto auto', justifyContent: phone ? undefined : 'end', gap: 8 }}>
        <button className="app-btn" onClick={onCancel} disabled={saving}>Cancelar</button>
        <button className="app-btn primary" onClick={() => void save()} disabled={saving}>{saving ? 'Salvando…' : 'Salvar configuração'}</button>
      </div>
    </div>
  )
}

function RemoveProject({ slug, name, onClose }: { slug: string; name: string; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const remove = async () => {
    setBusy(true)
    try {
      const r = await api.del<{ projects: ProjectSummary[] }>(`/api/projects/${encodeURIComponent(slug)}`)
      const s = useYui.getState()
      // limpa a seleção: reabrir o projeto pelo slug clonaria de novo do GitHub
      s.set({ projects: r.projects, appParams: {}, viewParams: {}, ...(s.activeProject === slug ? { activeProject: null } : {}) })
      s.say(`Removi ${name} do console. O repositório no GitHub continua lá.`)
      onClose()
    } catch (e) {
      useYui.getState().say(`Não consegui remover: ${(e as Error).message}.`)
      setBusy(false)
    }
  }
  return (
    <ConfirmDeleteModal
      title={`Remover ${name} do console?`}
      text="Apaga a pasta local do clone na VPS, inclusive alterações que não foram enviadas ao GitHub. O repositório no GitHub NÃO é afetado: dá para clonar de novo quando quiser."
      rows={[
        { label: 'Pasta', value: `/workspace/${slug}` },
        { label: 'GitHub', value: 'não é afetado' },
      ]}
      busy={busy}
      onCancel={onClose}
      onConfirm={() => void remove()}
    />
  )
}
