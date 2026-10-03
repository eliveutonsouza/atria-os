import { useMemo, useState } from 'react'
import type { ClaudeInitInfo } from '@shared/protocol'
import { useApi } from '../api/useApi'
import { submitText } from '../lib/actions'
import { C } from '../lib/colors'
import { useYui } from '../store/yui'
import { card, Empty, ErrorNote, Skeleton, useHeader } from './ui'
import { Chip, SearchBox, SmallBtn } from './kit'

// Mapa visual do Claude Code para o dia a dia: catálogo curado (shared/claude-guide.json) cruzado com o
// que está realmente instalado no Claude do container (skills, slash commands, plugins).

interface GuideCard {
  title: string
  what: string
  when: string
  example: string
  kind: 'slash' | 'flag' | 'shortcut' | 'concept'
  command?: string
  match?: string
}
interface GuideCat {
  id: string
  title: string
  description: string
  cards: GuideCard[]
}

const KIND_LABEL: Record<GuideCard['kind'], string> = { slash: 'comando', flag: 'CLI', shortcut: 'atalho', concept: 'conceito' }
const KIND_COLOR: Record<GuideCard['kind'], string> = { slash: C.cyan, flag: C.lav, shortcut: C.warn, concept: C.t2 }

function openInTerminal(c: GuideCard) {
  if (!c.command) return
  // Comandos do shell (claude --bg, claude -c…) vão para a aba Shell; slash commands para a aba Claude.
  const shell = c.kind === 'flag' || c.command.startsWith('claude')
  useYui.getState().show('terminal', { kind: shell ? 'shell' : 'claude', cmd: c.command })
}

export function ClaudeGuideView() {
  const guide = useApi<{ categories: GuideCat[] }>('/api/claude-guide')
  const caps = useApi<ClaudeInitInfo | { at?: string }>('/api/capabilities')
  const init = caps.data && 'tools' in caps.data ? (caps.data as ClaudeInitInfo) : null
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<string | null>(null)

  useHeader('Claude Code · mapa', 'O Claude Code no dia a dia', [
    { label: 'Abrir terminal', fn: () => useYui.getState().show('terminal', { kind: 'claude' }) },
    { label: 'Ferramentas', fn: () => useYui.getState().show('tools') },
  ])

  const installed = useMemo(() => new Set([...(init?.slashCommands ?? []), ...(init?.skills ?? [])]), [init])
  const n = q.trim().toLowerCase()

  if (guide.loading && !guide.data) return <Skeleton kpis={0} rows={6} />
  if (guide.error || !guide.data) return <ErrorNote text="Não consegui carregar o mapa do Claude Code." />

  const cats = guide.data.categories
    .filter((c) => !cat || c.id === cat)
    .map((c) => ({ ...c, cards: c.cards.filter((k) => !n || `${k.title} ${k.what} ${k.when} ${k.example}`.toLowerCase().includes(n)) }))
    .filter((c) => c.cards.length)

  const skillsFound = (init?.skills ?? []).filter((s) => !n || s.toLowerCase().includes(n))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Chip on={!cat} onClick={() => setCat(null)}>Tudo</Chip>
          {guide.data.categories.map((c) => (
            <Chip key={c.id} on={cat === c.id} onClick={() => setCat(cat === c.id ? null : c.id)}>
              {c.title}
            </Chip>
          ))}
        </div>
        <SearchBox value={q} onChange={setQ} placeholder="Buscar comando, atalho…" />
      </div>

      {init && (
        <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', fontSize: 13, color: C.t2 }}>
          <span><b style={{ fontSize: 24, fontWeight: 300, color: C.text, marginRight: 6 }}>{init.slashCommands.length}</b>comandos</span>
          <span><b style={{ fontSize: 24, fontWeight: 300, color: C.lav, marginRight: 6 }}>{init.skills.length}</b>skills</span>
          <span><b style={{ fontSize: 24, fontWeight: 300, color: C.cyan, marginRight: 6 }}>{init.mcp.length}</b>MCP</span>
          <span><b style={{ fontSize: 24, fontWeight: 300, color: C.ok, marginRight: 6 }}>{init.plugins.length}</b>plugins</span>
          <span><b style={{ fontSize: 24, fontWeight: 300, color: C.text, marginRight: 6 }}>{init.agents.length}</b>subagentes</span>
        </div>
      )}

      {cats.length === 0 && skillsFound.length === 0 && <Empty text="Nada encontrado com essa busca." />}

      {cats.map((c) => (
        <section key={c.id} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
            <span className="eyebrow" style={{ color: C.cyan }}>{c.title}</span>
            <span style={{ fontSize: 13, color: C.t3 }}>{c.description}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 12 }}>
            {c.cards.map((k) => {
              const isInstalled = k.match ? installed.has(k.match) : null
              return (
                <article key={k.title} style={{ ...card, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <span className={k.kind === 'concept' ? undefined : 'mono'} style={{ fontSize: k.kind === 'concept' ? 15 : 14, fontWeight: 600, color: C.text }}>{k.title}</span>
                    <span style={{ fontSize: 11, color: KIND_COLOR[k.kind], whiteSpace: 'nowrap' }}>
                      {KIND_LABEL[k.kind]}
                      {isInstalled === true && <span style={{ color: C.ok }}> · instalado</span>}
                      {isInstalled === false && init && <span style={{ color: C.t3 }}> · não encontrado</span>}
                    </span>
                  </div>
                  <span style={{ fontSize: 13, color: '#c9cde0', lineHeight: 1.5 }}>{k.what}</span>
                  <span style={{ fontSize: 12, color: C.t3, lineHeight: 1.5 }}>Quando: {k.when}</span>
                  <code className="mono" style={{ fontSize: 12, color: '#a9e9f8', background: 'rgba(0,0,0,.3)', borderRadius: 8, padding: '6px 10px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{k.example}</code>
                  <div style={{ display: 'flex', gap: 6, marginTop: 'auto', paddingTop: 4, flexWrap: 'wrap' }}>
                    {k.command && <SmallBtn onClick={() => openInTerminal(k)}>Abrir no terminal</SmallBtn>}
                    <SmallBtn onClick={() => submitText(`Sobre o Claude Code: ${k.title} — ${k.what} Me ajuda a usar isso agora.`)}>Pedir à Yui</SmallBtn>
                  </div>
                </article>
              )
            })}
          </div>
        </section>
      ))}

      {(!cat || cat === 'skills') && skillsFound.length > 0 && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span className="eyebrow" style={{ color: C.lav }}>Skills instaladas neste Claude · {skillsFound.length}</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {skillsFound.map((s) => (
              <Chip key={s} onClick={() => useYui.getState().show('terminal', { kind: 'claude', cmd: `/${s} ` })} title="Abrir no terminal">
                /{s}
              </Chip>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
