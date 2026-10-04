import type { CompanyCategory, CompanyDoc } from '@shared/protocol'
import { useYui } from '../store/yui'

// Empresa: helpers sem componentes (cores, rótulos, upload com progresso, navegação entre abas).

export type CompanyTab = 'perfil' | 'documentos' | 'busca'

export function goTab(id: CompanyTab | `doc:${string}`) {
  useYui.getState().set({ appParams: { id } })
}

export const STAGES = ['Recebido', 'Lendo / OCR', 'Extraindo dados', 'Embeddings', 'No Qdrant'] as const

export const CAT_COLORS: Record<CompanyCategory, [string, string]> = {
  Comercial: ['rgba(245,181,74,0.14)', '#f5c97a'],
  Contratos: ['rgba(166,140,247,0.16)', '#cbbcff'],
  Marca: ['rgba(247,140,200,0.14)', '#f9a8d6'],
  Processos: ['rgba(103,216,242,0.13)', '#a9e9f8'],
  Financeiro: ['rgba(79,224,176,0.13)', '#7ff0c8'],
  Clientes: ['rgba(223,227,243,0.1)', '#dfe3f3'],
  Outros: ['rgba(140,146,173,0.14)', '#b4b9cf'],
}

const TYPE_COLORS: Record<string, [string, string]> = {
  PDF: ['#3a1622', '#ff8fa3'],
  DOCX: ['#142446', '#8fb6ff'],
  DOC: ['#142446', '#8fb6ff'],
  ODT: ['#142446', '#8fb6ff'],
  PPTX: ['#3a2512', '#ffb36b'],
  XLSX: ['#0f3326', '#6be3a8'],
  XLS: ['#0f3326', '#6be3a8'],
  CSV: ['#0f3326', '#6be3a8'],
  JPG: ['#2a1d40', '#cbbcff'],
  JPEG: ['#2a1d40', '#cbbcff'],
  PNG: ['#2a1d40', '#cbbcff'],
  WEBP: ['#2a1d40', '#cbbcff'],
  TIF: ['#2a1d40', '#cbbcff'],
  TIFF: ['#2a1d40', '#cbbcff'],
  MD: ['#1b2045', '#a9e9f8'],
  TXT: ['#1b2045', '#a9e9f8'],
}
export const typeColors = (ext: string): [string, string] => TYPE_COLORS[ext.toUpperCase()] ?? ['#1b2045', '#a9e9f8']

export const ACCEPT = '.pdf,.docx,.doc,.pptx,.xlsx,.xls,.odt,.txt,.md,.csv,.png,.jpg,.jpeg,.webp,.tif,.tiff'

export const isImage = (d: CompanyDoc) => d.mime.startsWith('image/') || ['PNG', 'JPG', 'JPEG', 'WEBP'].includes(d.ext.toUpperCase())
export const isPdf = (d: CompanyDoc) => d.mime === 'application/pdf' || d.ext.toUpperCase() === 'PDF'

export function statusOf(d: CompanyDoc): { text: string; color: string } {
  if (d.state === 'error') return { text: d.error ? `Erro: ${d.error}` : 'Erro na leitura', color: '#f39aa4' }
  if (d.state === 'ready') return { text: 'Pronto para a Yui e os agentes', color: '#7ff0c8' }
  if (d.state === 'queued') return { text: 'Na fila…', color: '#a9e9f8' }
  return { text: `${STAGES[Math.min(d.stage, 4)]}…`, color: '#a9e9f8' }
}

// Segmentos da barra de pipeline (5 etapas).
export function pipeSegments(d: CompanyDoc): { label: string; bg: string; active: boolean }[] {
  return STAGES.map((label, i) => {
    if (d.state === 'error') {
      const failed = Math.min(d.stage, 4)
      return { label, bg: i < failed ? '#67d8f2' : i === failed ? '#e2566a' : 'rgba(255,255,255,0.08)', active: false }
    }
    if (d.state === 'ready') return { label, bg: '#4fe0b0', active: false }
    if (i < d.stage) return { label, bg: '#67d8f2', active: false }
    if (i === d.stage && d.state === 'processing') return { label, bg: 'repeating-linear-gradient(90deg, #67d8f2 0 7px, #a68cf7 7px 14px)', active: true }
    return { label, bg: 'rgba(255,255,255,0.08)', active: false }
  })
}

export function fmtDate(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diff = (now.getTime() - d.getTime()) / 1000
  if (diff < 90) return 'agora'
  const hm = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  if (d.toDateString() === now.toDateString()) return `hoje ${hm}`
  const y = new Date(now)
  y.setDate(now.getDate() - 1)
  if (d.toDateString() === y.toDateString()) return `ontem ${hm}`
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

export const fmtNum = (n: number) => n.toLocaleString('pt-BR')
export const fmtSize = (b: number) => (b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`)
export const noExt = (name: string) => name.replace(/\.[^.]+$/, '')

export interface UploadResult {
  created: CompanyDoc[]
  duplicates: string[]
  rejected: { name: string; reason: string }[]
}

// Upload com progresso (fetch não informa progresso de envio).
export function uploadFiles(files: File[], onProgress: (pct: number) => void, category?: string): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const fd = new FormData()
    if (category) fd.append('category', category)
    for (const f of files) fd.append('files', f, f.name)
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/company/documents')
    xhr.withCredentials = true
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () => {
      if (xhr.status === 401) {
        useYui.getState().set({ authed: false })
        return reject(new Error('sessão expirada'))
      }
      let body: unknown = null
      try {
        body = JSON.parse(xhr.responseText)
      } catch {
        /* corpo vazio */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as UploadResult)
      else reject(new Error((body as { error?: string } | null)?.error ?? `falha no envio (${xhr.status})`))
    }
    xhr.onerror = () => reject(new Error('falha de rede no envio'))
    xhr.send(fd)
  })
}

export async function uploadLogo(file: File): Promise<void> {
  const fd = new FormData()
  fd.append('file', file, file.name)
  const r = await fetch('/api/company/logo', { method: 'POST', body: fd, credentials: 'same-origin' })
  if (!r.ok) {
    let msg = `falha no envio do logo (${r.status})`
    try {
      msg = ((await r.json()) as { error?: string }).error ?? msg
    } catch {
      /* corpo vazio */
    }
    throw new Error(msg)
  }
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('') || '?'

// Ícones (caminhos SVG 24×24, traço)
export const Icon = {
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  redo: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  trash: 'M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12',
  upload: 'M12 16V4M7 9l5-5 5 5M4 16v4h16v-4',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-3.5-3.5',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  download: 'M12 4v12M7 11l5 5 5-5M4 20h16',
}
