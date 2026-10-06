import { useEffect, useMemo, useRef, useState } from 'react'
import type { CompanyProfile, CompanyProfileInput, CompanyStats } from '@shared/protocol'
import { api } from '../api/client'
import { onCompanyEvent } from '../api/events'
import { C } from '../lib/colors'
import { useYui } from '../store/yui'
import { fmtNum, goTab, initials, uploadLogo, Icon, useStacked } from './api'
import { Svg } from './ui'

// Perfil da empresa (Main.dc.html): o que entra no prompt de todo agente e da Yui.

const TONES = ['Próximo e direto', 'Formal', 'Técnico', 'Descontraído', 'Consultivo']
const SEGMENTS = ['Software e serviços digitais', 'Agência de marketing', 'Saúde', 'Varejo', 'Educação', 'Indústria', 'Serviços profissionais', 'Outro']

const EMPTY: CompanyProfileInput = { name: '', legalName: '', cnpj: '', segment: '', site: '', city: '', about: '', audience: '', tone: '', services: [] }

function pick(p: CompanyProfile): CompanyProfileInput {
  return { name: p.name, legalName: p.legalName, cnpj: p.cnpj, segment: p.segment, site: p.site, city: p.city, about: p.about, audience: p.audience, tone: p.tone, services: p.services.map((s) => ({ ...s })) }
}

// Prévia local enquanto edita (o servidor devolve a oficial em agentPreview ao salvar).
function localPreview(f: CompanyProfileInput, stats: CompanyStats | null) {
  const lines = [`# Empresa: ${f.name || '[nome]'}`]
  if (f.segment) lines.push(`Segmento: ${f.segment}`)
  if (f.about) lines.push(`O que faz: ${f.about}`)
  if (f.audience) lines.push(`Para quem: ${f.audience}`)
  if (f.tone) lines.push(`Tom de voz: ${f.tone.toLowerCase()}`)
  const sv = f.services.filter((s) => s.name.trim())
  if (sv.length) lines.push(`Serviços: ${sv.map((s) => (s.price ? `${s.name} (${s.price})` : s.name)).join('; ')}`)
  lines.push(`Base: empresa_consultar("pergunta") →\n  ${stats ? `${fmtNum(stats.ready)} documentos, ${fmtNum(stats.chunks)} trechos` : 'documentos da empresa'}`)
  return lines.join('\n')
}

export function ProfileTab() {
  const narrow = useYui((s) => s.narrow)
  const stacked = useStacked()
  const [profile, setProfile] = useState<CompanyProfile | null>(null)
  const [form, setForm] = useState<CompanyProfileInput>(EMPTY)
  const [stats, setStats] = useState<CompanyStats | null>(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null)
  const [logoBusy, setLogoBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api.get<CompanyProfile>('/api/company/profile').then((p) => {
      setProfile(p)
      setForm(pick(p))
    }).catch((e: Error) => setMsg({ text: e.message, err: true }))
    const loadStats = () => api.get<CompanyStats>('/api/company/stats').then(setStats).catch(() => {})
    loadStats()
    return onCompanyEvent((ev) => {
      if (ev.type === 'company.profile.updated') setProfile(ev.profile)
      else loadStats()
    })
  }, [])

  const dirty = useMemo(() => !!profile && JSON.stringify(pick(profile)) !== JSON.stringify(form), [profile, form])
  const set = <K extends keyof CompanyProfileInput>(k: K, v: CompanyProfileInput[K]) => setForm((f) => ({ ...f, [k]: v }))

  const save = () => {
    setSaving(true)
    setMsg(null)
    api
      .put<CompanyProfile>('/api/company/profile', { ...form, services: form.services.filter((s) => s.name.trim()) })
      .then((p) => {
        setProfile(p)
        setForm(pick(p))
        setMsg({ text: 'Salvo. Os agentes já recebem o perfil novo.' })
      })
      .catch((e: Error) => setMsg({ text: e.message, err: true }))
      .finally(() => setSaving(false))
  }

  const onLogo = (file: File | undefined) => {
    if (!file) return
    setLogoBusy(true)
    uploadLogo(file)
      .then(() => api.get<CompanyProfile>('/api/company/profile'))
      .then((p) => setProfile(p))
      .catch((e: Error) => setMsg({ text: e.message, err: true }))
      .finally(() => setLogoBusy(false))
  }
  const removeLogo = () => {
    api.del('/api/company/logo').then(() => api.get<CompanyProfile>('/api/company/profile')).then(setProfile).catch((e: Error) => setMsg({ text: e.message, err: true }))
  }

  const ini = initials(form.name)
  const logo = (sz: number, radius: number, font: number) =>
    profile?.hasLogo ? (
      <img src={`/api/company/logo?v=${profile.logoVersion}`} alt={`Logo de ${form.name || 'empresa'}`} style={{ width: sz, height: sz, borderRadius: radius, objectFit: 'contain', background: 'rgba(255,255,255,0.04)' }} />
    ) : (
      <span style={{ width: sz, height: sz, borderRadius: radius, background: 'linear-gradient(135deg, #67d8f2, #a68cf7)', color: '#0a0c1d', fontSize: font, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{ini}</span>
    )

  const preview = dirty || !profile ? localPreview(form, stats) : profile.agentPreview || localPreview(form, stats)
  const toneIsCustom = !!form.tone && !TONES.includes(form.tone)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
        <span role="status" style={{ fontSize: 12, color: msg?.err ? C.crit : dirty ? C.warn : C.t2 }}>
          {msg ? msg.text : dirty ? 'Alterações não salvas' : profile?.updatedAt ? 'Perfil salvo' : 'Perfil ainda não preenchido'}
        </span>
        <button className="app-btn primary" disabled={saving || !dirty} onClick={save} style={{ height: narrow ? 44 : 36, opacity: dirty ? 1 : 0.6 }}>
          {saving ? 'Salvando…' : 'Salvar perfil'}
        </button>
      </div>

      <section style={{ display: 'grid', gridTemplateColumns: stacked ? 'minmax(0,1fr)' : 'minmax(0, 1fr) 360px', gap: 16, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          <div className="co-card" style={{ padding: 18, display: 'grid', gridTemplateColumns: narrow ? 'minmax(0,1fr)' : '140px minmax(0, 1fr)', gap: 20 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
              <button
                aria-label={profile?.hasLogo ? 'Trocar logo' : 'Enviar logo'}
                onClick={() => fileRef.current?.click()}
                disabled={logoBusy}
                style={{ width: 128, height: 128, borderRadius: 22, border: '1px dashed rgba(103,216,242,0.45)', background: 'radial-gradient(circle at 50% 40%, rgba(103,216,242,0.14), rgba(10,12,29,0.6))', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, color: C.t2, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                {logo(profile?.hasLogo ? 92 : 56, 14, 22)}
                <span style={{ fontSize: 11 }}>{logoBusy ? 'Enviando…' : profile?.hasLogo ? 'Trocar logo' : 'Enviar logo'}</span>
              </button>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => onLogo(e.target.files?.[0])} />
              {profile?.hasLogo ? (
                <button className="app-btn small danger" onClick={removeLogo}>
                  Remover logo
                </button>
              ) : (
                <span style={{ fontSize: 10.5, color: C.t3, textAlign: 'center' }}>PNG, JPG ou WEBP · até 2 MB</span>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: narrow ? 'minmax(0,1fr)' : 'repeat(2, minmax(0, 1fr))', gap: '12px 14px' }}>
              <label className="co-label">
                Nome da empresa
                <input className="co-input" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Ex.: ESM Softwares" />
              </label>
              <label className="co-label">
                Razão social
                <input className="co-input" value={form.legalName} onChange={(e) => set('legalName', e.target.value)} placeholder="Razão social Ltda." />
              </label>
              <label className="co-label">
                CNPJ
                <input className="co-input" value={form.cnpj} onChange={(e) => set('cnpj', e.target.value)} placeholder="00.000.000/0001-00" style={{ fontFamily: 'var(--mono)' }} inputMode="numeric" />
              </label>
              <label className="co-label">
                Segmento
                <select className="co-input" value={SEGMENTS.includes(form.segment) || !form.segment ? form.segment : 'Outro'} onChange={(e) => set('segment', e.target.value)}>
                  <option value="">Escolha…</option>
                  {SEGMENTS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                  {!!form.segment && !SEGMENTS.includes(form.segment) && <option value={form.segment}>{form.segment}</option>}
                </select>
              </label>
              <label className="co-label">
                Site
                <input className="co-input" value={form.site} onChange={(e) => set('site', e.target.value)} placeholder="https://" inputMode="url" />
              </label>
              <label className="co-label">
                Cidade / atendimento
                <input className="co-input" value={form.city} onChange={(e) => set('city', e.target.value)} placeholder="Cidade · remoto em todo o Brasil" />
              </label>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: narrow ? 'minmax(0,1fr)' : 'repeat(2, minmax(0, 1fr))', gap: 14 }}>
            <div className="co-card" style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label className="co-label">
                O que a empresa faz (em 2 a 4 frases)
                <textarea className="co-input" rows={4} value={form.about} onChange={(e) => set('about', e.target.value)} placeholder="Desenvolvemos sistemas, sites e automações com IA para…" />
              </label>
              <label className="co-label">
                Para quem (público e cliente ideal)
                <textarea className="co-input" rows={3} value={form.audience} onChange={(e) => set('audience', e.target.value)} placeholder="Clínicas, agências e comércios que querem…" />
              </label>
              <div className="co-label">
                Tom de voz
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {TONES.map((t) => (
                    <button key={t} className={`co-chip${form.tone === t ? ' on' : ''}`} aria-pressed={form.tone === t} onClick={() => set('tone', t)}>
                      {t}
                    </button>
                  ))}
                </div>
                <input className="co-input" aria-label="Tom de voz personalizado" value={toneIsCustom ? form.tone : ''} onChange={(e) => set('tone', e.target.value)} placeholder="Ou descreva com suas palavras…" style={{ height: 36, fontSize: narrow ? 16 : 13 }} />
              </div>
            </div>

            <div className="co-card" style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>Serviços e preços</span>
                <button className="app-btn small" onClick={() => set('services', [...form.services, { name: '', price: '' }])}>
                  + Serviço
                </button>
              </div>
              {form.services.map((s, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: narrow ? 'minmax(0, 1fr) 100px 44px' : 'minmax(0, 1fr) 120px 32px', gap: 8, alignItems: 'center' }}>
                  <input className="co-input" aria-label={`Serviço ${i + 1}`} value={s.name} placeholder="Nome do serviço" style={{ height: 36, fontSize: narrow ? 16 : 13 }} onChange={(e) => set('services', form.services.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                  <input className="co-input" aria-label={`Preço do serviço ${i + 1}`} value={s.price} placeholder="R$" style={{ height: 36, fontSize: narrow ? 16 : 13, color: '#f5c97a', fontFamily: 'var(--mono)' }} onChange={(e) => set('services', form.services.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} />
                  <button aria-label={`Remover serviço ${s.name || i + 1}`} className="co-icon-btn danger" style={narrow ? { width: 44, height: 44 } : undefined} onClick={() => set('services', form.services.filter((_, j) => j !== i))}>
                    <Svg d={Icon.trash} size={14} />
                  </button>
                </div>
              ))}
              {!form.services.length && <span style={{ fontSize: 12.5, color: C.t3 }}>Nenhum serviço ainda. Adicione o que você vende.</span>}
              <span style={{ fontSize: 11.5, color: C.t3, marginTop: 'auto' }}>Preços também podem vir de uma tabela em PDF — a base de documentos encontra.</span>
            </div>
          </div>
        </div>

        <aside aria-label="O que os agentes sabem" style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          <div style={{ padding: 18, borderRadius: 16, background: 'linear-gradient(160deg, rgba(103,216,242,0.08), rgba(166,140,247,0.06))', border: '1px solid rgba(103,216,242,0.22)', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
              {logo(46, 12, 18)}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <span style={{ fontSize: 16, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{form.name || 'Sua empresa'}</span>
                <span style={{ fontSize: 12, color: C.t2 }}>{form.segment || 'Segmento não informado'}</span>
              </div>
            </div>
            <div className="co-eyebrow" style={{ color: C.cyan }}>Como os agentes vão ver</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 11.5, lineHeight: 1.65, color: '#c9cde0', padding: 12, borderRadius: 10, background: 'rgba(6,7,13,0.6)', border: '1px solid rgba(255,255,255,0.06)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 320, overflowY: 'auto' }}>{preview}</div>
            <span style={{ fontSize: 11.5, color: '#8c92ad' }}>Entra no início de toda conversa da Yui e de toda execução de agente. Detalhes ficam na base de documentos.</span>
          </div>
          <div className="co-card" style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Base de conhecimento</span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
              {[
                [stats?.docs, 'documentos', C.cyan],
                [stats?.pages, 'páginas', C.violet],
                [stats?.chunks, 'trechos', C.ok],
              ].map(([v, l, c]) => (
                <div key={l as string} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 24, fontWeight: 300, color: c as string }}>{v == null ? '—' : fmtNum(v as number)}</span>
                  <span style={{ fontSize: 11, color: C.t2 }}>{l as string}</span>
                </div>
              ))}
            </div>
            <button className="app-btn" style={{ height: 40 }} onClick={() => goTab('documentos')}>
              Gerenciar documentos →
            </button>
          </div>
        </aside>
      </section>
    </div>
  )
}
