import { useMemo, useState } from 'react'
import type { HelpAnswer } from '@shared/protocol'
import { api } from '../api/client'
import { C } from '../lib/colors'
import { useYui } from '../store/yui'
import { renderNote } from '../vault/markdown'
import { copyText, goHelp, openPage, PAGE_LABEL, sendToYui, type HelpTab, type Step } from './api'

// Componentes visuais compartilhados das abas da Ajuda.

export function Tabs({ active }: { active: HelpTab }) {
  const t = (id: HelpTab, label: string) => (
    <button key={id} role="tab" aria-selected={active === id} className={`hp-tab${active === id ? ' on' : ''}`} onClick={() => goHelp(id)}>
      {label}
    </button>
  )
  return (
    <nav role="tablist" aria-label="Seções da ajuda" className="hp-tabs no-print" data-own-scroll>
      {t('inicio', 'Início')}
      {t('guias', 'Guias')}
      {t('receitas', 'Receitas')}
      {t('resultados', 'Resultados')}
      {t('faq', 'Perguntas frequentes')}
    </nav>
  )
}

export function Orb({ size = 30 }: { size?: number }) {
  return <span aria-hidden style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0, background: 'radial-gradient(circle at 38% 34%, #ffffff, #67d8f2 34%, #a68cf7 80%)', boxShadow: '0 0 18px rgba(103,216,242,.45)' }} />
}

export function Md({ md, className = '' }: { md: string; className?: string }) {
  const html = useMemo(() => renderNote(md), [md])
  return <div className={`hp-md ${className}`} dangerouslySetInnerHTML={{ __html: html }} />
}

export function Toast({ msg }: { msg: string | null }) {
  return msg ? (
    <div role="status" className="hp-toast">
      {msg}
    </div>
  ) : null
}

// Frase pronta para dizer à Yui: copiar ou enviar direto.
export function PhraseRow({ text, onToast }: { text: string; onToast: (m: string) => void }) {
  const [busy, setBusy] = useState(false)
  return (
    <div className="hp-phrase">
      <span style={{ flex: 1, minWidth: 0 }}>“{text}”</span>
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        <button className="hp-mini" onClick={() => copyText(text).then(() => onToast('Copiado.'), () => onToast('Não consegui copiar.'))}>
          Copiar
        </button>
        <button
          className="hp-mini violet"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            sendToYui(text)
              .then(() => onToast('Enviado — acompanhe na Yui.'))
              .catch(() => onToast('Não consegui enviar.'))
              .finally(() => setBusy(false))
          }}
        >
          Enviar à Yui
        </button>
      </div>
    </div>
  )
}

export function StepList({ steps, color = C.cyan, onToast }: { steps: Step[]; color?: string; onToast: (m: string) => void }) {
  return (
    <ol className="hp-steps">
      {steps.map((s, i) => (
        <li key={i}>
          <span className="hp-step-n" style={{ color, background: `${color}24` }}>
            {i + 1}
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
            {s.title && <span style={{ fontSize: 14, fontWeight: 600 }}>{s.title}</span>}
            {s.text && <Md md={s.text} className="hp-md-inline" />}
            {s.say.map((x) => (
              <PhraseRow key={x} text={x} onToast={onToast} />
            ))}
          </div>
        </li>
      ))}
    </ol>
  )
}

// Destaca citações [Guia: X] / [Receita: X] na resposta.
function AnswerText({ text }: { text: string }) {
  const parts = text.split(/(\[(?:Guia|Receita|FAQ|Perguntas frequentes)[^\]]*\])/g)
  return (
    <span style={{ fontSize: 14, lineHeight: 1.6, color: '#dfe3f3', whiteSpace: 'pre-wrap' }}>
      {parts.map((p, i) =>
        /^\[(Guia|Receita|FAQ|Perguntas)/.test(p) ? (
          <span key={i} className="hp-cite">
            {p}
          </span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </span>
  )
}

const EXAMPLES = ['Como peço um site novo?', 'O que é uma missão?', 'Como aprovo pelo celular?', 'Onde vejo o que os agentes fizeram?']

export function AskBox({ compact = false, examples = EXAMPLES }: { compact?: boolean; examples?: string[] }) {
  const narrow = useYui((s) => s.narrow)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [ans, setAns] = useState<HelpAnswer | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const ask = (text: string) => {
    const pergunta = text.trim()
    if (!pergunta || busy) return
    setQ(pergunta)
    setBusy(true)
    setErr(null)
    api
      .post<HelpAnswer>('/api/help/ask', { pergunta })
      .then(setAns)
      .catch((e: Error) => setErr(e.message || 'Não consegui perguntar agora.'))
      .finally(() => setBusy(false))
  }
  const reset = () => {
    setAns(null)
    setQ('')
    setErr(null)
  }
  return (
    <section aria-label="Pergunte" className="hp-ask">
      <form
        style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: narrow ? 'wrap' : 'nowrap' }}
        onSubmit={(e) => {
          e.preventDefault()
          ask(q)
        }}
      >
        {!narrow && <Orb size={34} />}
        <label style={{ flex: 1, display: 'flex', minWidth: 0 }}>
          <span className="sr-only">Pergunte</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={compact ? 'Pergunte à Yui…' : 'Pergunte qualquer coisa: "como agendo um relatório toda segunda?"'}
            className="hp-input"
            style={{ height: compact ? 42 : 46 }}
          />
        </label>
        <button type="submit" className="app-btn primary" disabled={busy || !q.trim()} style={{ height: compact ? 42 : 46, padding: '0 18px', borderRadius: 13, width: narrow ? '100%' : undefined }}>
          {busy ? 'Pensando…' : 'Perguntar'}
        </button>
      </form>
      {!ans && !busy && !err && examples.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingLeft: narrow ? 0 : 44 }}>
          {examples.map((x) => (
            <button key={x} className="hp-chip" onClick={() => ask(x)}>
              {x}
            </button>
          ))}
        </div>
      )}
      {busy && <div style={{ paddingLeft: narrow ? 0 : 44, fontSize: 13, color: C.t2 }}>A Yui está lendo os guias…</div>}
      {err && <div style={{ paddingLeft: narrow ? 0 : 44, fontSize: 13, color: C.crit }}>{err}</div>}
      {ans && (
        <div className="hp-answer" style={{ marginLeft: narrow ? 0 : 44 }}>
          {ans.semResposta || !ans.resposta ? (
            <span style={{ fontSize: 14, lineHeight: 1.6, color: '#dfe3f3' }}>
              Ainda não tenho um guia que responda isso. Anotei a pergunta — ela vira um guia novo. Enquanto isso, tente dizer o mesmo para a Yui na conversa.
            </span>
          ) : (
            <AnswerText text={ans.resposta} />
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {ans.fontes
              .filter((f) => f.kind !== 'faq')
              .slice(0, 3)
              .map((f) => (
                <button key={`${f.kind}:${f.id}`} className="hp-mini cyan" onClick={() => goHelp(`${f.kind}:${f.id}`)}>
                  {f.kind === 'guia' ? 'Ler o guia' : 'Ler a receita'}: {f.titulo}
                </button>
              ))}
            {ans.abrir && (
              <button className="hp-mini" onClick={() => openPage(ans.abrir!)}>
                Abrir {PAGE_LABEL[ans.abrir] ?? ans.abrir}
              </button>
            )}
            <button className="hp-mini ghost" onClick={reset}>
              Nova pergunta
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

export function Loading({ error }: { error: string | null }) {
  return <div style={{ padding: 24, fontSize: 13.5, color: error ? C.crit : C.t2 }}>{error ? `Não consegui carregar a documentação: ${error}` : 'A documentação está carregando…'}</div>
}
