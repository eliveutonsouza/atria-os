import { useEffect, useRef, useState } from 'react'
import type { AppPage, HelpIndex, HelpTaskType } from '@shared/protocol'
import { api } from '../api/client'
import { useYui } from '../store/yui'

// Ajuda: helpers sem componentes (navegação entre abas, índice em cache, envio de frases para a Yui).

export type HelpTab = 'inicio' | 'guias' | 'receitas' | 'resultados' | 'faq'

export function goHelp(id: string) {
  useYui.getState().set({ appParams: { id } })
}

export function openPage(page: AppPage) {
  useYui.getState().set({ appPage: page, appParams: {} })
}

// AppPage → guia (botão "?" do cabeçalho de cada tela)
export const GUIDE_FOR_PAGE: Partial<Record<AppPage, string>> = {
  overview: 'visao-geral',
  ops: 'operacoes',
  agents: 'agentes',
  runs: 'execucoes',
  inbox: 'aprovacoes',
  missions: 'missoes',
  workflows: 'workflows',
  schedule: 'agendamentos',
  projects: 'projetos',
  company: 'empresa',
  vault: 'vault',
  brain: 'cerebro',
  browser: 'navegador',
  terminal: 'terminal',
  claude: 'claude-code',
  tools: 'conectores',
  skills: 'skills',
  infra: 'infra',
  settings: 'configuracoes',
}

export const PAGE_LABEL: Partial<Record<AppPage, string>> = {
  overview: 'Visão geral',
  ops: 'Operações',
  agents: 'Agentes',
  runs: 'Execuções',
  inbox: 'Aprovações',
  missions: 'Missões',
  workflows: 'Workflows',
  schedule: 'Agendamentos',
  projects: 'Projetos',
  company: 'Empresa',
  vault: 'Vault',
  brain: 'Cérebro',
  browser: 'Navegador',
  terminal: 'Terminal',
  claude: 'Claude Code',
  tools: 'Conectores & MCP',
  skills: 'Skills',
  infra: 'Infra & logs',
  settings: 'Configurações',
  help: 'Ajuda',
}

export function fmtHours(h: number) {
  return h >= 10 ? `${Math.round(h)} h` : `${h.toFixed(1).replace('.', ',')} h`
}

export const GROUP_ORDER = ['Começar', 'Acompanhar', 'Organizar', 'Conhecimento', 'Ferramentas', 'Sistema']

export const TIPO_COLOR: Record<HelpTaskType, string> = {
  codigo: '#67d8f2',
  pesquisa: '#a68cf7',
  textos: '#f78cc8',
  assistente: '#cbbcff',
  workflow: '#7aa2ff',
  rotina: '#4fe0b0',
  consulta: '#f5b54a',
  documento: '#dfe3f3',
}

export const TIPO_LABEL: Record<HelpTaskType, string> = {
  codigo: 'Código',
  pesquisa: 'Pesquisa',
  textos: 'Textos',
  assistente: 'Assistente',
  workflow: 'Workflows',
  rotina: 'Rotinas',
  consulta: 'Base da empresa',
  documento: 'Documentos',
}

// Índice compartilhado entre as abas (uma busca por sessão de página).
let cache: HelpIndex | null = null
let inflight: Promise<HelpIndex> | null = null

export function useHelpIndex(): { index: HelpIndex | null; error: string | null } {
  const [index, setIndex] = useState<HelpIndex | null>(cache)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (cache) return
    inflight ??= api.get<HelpIndex>('/api/help')
    let alive = true
    inflight
      .then((ix) => {
        cache = ix
        if (alive) setIndex(ix)
      })
      .catch((e: Error) => {
        inflight = null
        if (alive) setError(e.message)
      })
    return () => {
      alive = false
    }
  }, [])
  return { index, error }
}

export function sendToYui(text: string) {
  return api.post('/api/chat', { text, context: { view: null, mode: 'center' } })
}

export function copyText(text: string) {
  return navigator.clipboard?.writeText(text) ?? Promise.reject(new Error('sem área de transferência'))
}

// Tira aspas externas das frases do frontmatter.
export const unquote = (s: string) => s.trim().replace(/^["“']|["”']$/g, '')

export const asList = (v: string | string[] | undefined): string[] => (Array.isArray(v) ? v : v ? [v] : []).map((x) => String(x)).filter(Boolean)
export const asText = (v: string | string[] | undefined): string => (Array.isArray(v) ? v.join(' ') : v ?? '')

export interface Step {
  title: string
  text: string
  say: string[]
}

// Separa o corpo do guia em seções "## …"; o "Passo a passo" vira lista de etapas.
export function splitSections(md: string): { title: string; body: string }[] {
  const out: { title: string; body: string }[] = []
  const parts = md.split(/^##\s+/m)
  const head = parts.shift()?.replace(/^#\s+.*$/m, '').trim()
  if (head) out.push({ title: '', body: head })
  for (const p of parts) {
    const nl = p.indexOf('\n')
    out.push({ title: (nl < 0 ? p : p.slice(0, nl)).trim(), body: nl < 0 ? '' : p.slice(nl + 1).trim() })
  }
  return out
}

export function parseSteps(body: string): Step[] {
  const steps: Step[] = []
  for (const raw of body.split('\n')) {
    const line = raw.trim()
    const m = /^\d+[.)]\s+(.*)$/.exec(line)
    if (m) {
      const b = /^\*\*(.+?)\*\*\s*(.*)$/.exec(m[1])
      steps.push({ title: b ? b[1].replace(/[.:]$/, '') : '', text: b ? b[2] : m[1], say: [] })
      continue
    }
    const cur = steps[steps.length - 1]
    if (!cur || !line) continue
    if (line.startsWith('>')) {
      const q = line.replace(/^>\s*/, '').replace(/^diga:\s*/i, '')
      cur.say.push(unquote(q))
    } else cur.text += ` ${line.replace(/^[-*]\s+/, '')}`
  }
  return steps
}

// Mensagem curta que some sozinha (copiado, enviado à Yui…).
export function useToast(): [string | null, (msg: string) => void] {
  const [msg, setMsg] = useState<string | null>(null)
  const t = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(t.current), [])
  const show = (m: string) => {
    setMsg(m)
    clearTimeout(t.current)
    t.current = setTimeout(() => setMsg(null), 2600)
  }
  return [msg, show]
}
