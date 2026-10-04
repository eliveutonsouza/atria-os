import { useEffect, useRef, useState } from 'react'
import type { VaultGraphPayload, VaultNode } from '@shared/protocol'
import { api } from '../api/client'
import { onVaultChanged } from '../api/events'
import { useYui } from '../store/yui'
import { GHOST, galaxy } from './palette'

// Grafo do vault com atualização ao vivo (evento vault.changed).
export function useVaultGraph() {
  const [graph, setGraph] = useState<VaultGraphPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => {
    let alive = true
    const load = () =>
      api
        .get<VaultGraphPayload>('/api/vault/graph')
        .then((g) => {
          if (alive) {
            setGraph(g)
            setError(null)
          }
        })
        .catch((e: Error) => alive && setError(e.message))
    load()
    const off = onVaultChanged(() => {
      clearTimeout(timer.current)
      timer.current = setTimeout(load, 250)
    })
    return () => {
      alive = false
      off()
      clearTimeout(timer.current)
    }
  }, [])
  return { graph, error }
}

export function nodeColors(n: Pick<VaultNode, 'folder' | 'ghost'>) {
  if (n.ghost) return { ...GHOST, name: 'Nota que ainda não existe' }
  return galaxy(n.folder)
}

export function degrees(g: VaultGraphPayload): Map<string, number> {
  const d = new Map<string, number>()
  for (const l of g.links) {
    d.set(l.s, (d.get(l.s) ?? 0) + 1)
    d.set(l.t, (d.get(l.t) ?? 0) + 1)
  }
  return d
}

export const HUB_DEGREE = 6

export function openInEditor(path: string) {
  useYui.getState().set({ appPage: 'vault', appParams: { id: path } })
}

export function openConstellation(path: string | null) {
  useYui.getState().set({ appPage: 'brain', appParams: path ? { id: path } : {} })
}

export function askYui(title: string) {
  return api.post('/api/chat', { text: `Me fala da nota "${title}" do vault: o que ela diz e com o que se conecta.` })
}

// Primeiras linhas legíveis de uma nota (sem frontmatter, título e marcação pesada).
export function excerpt(text: string, max = 260): string {
  let body = text
  if (body.startsWith('---')) {
    const end = body.indexOf('\n---', 3)
    if (end > 0) body = body.slice(body.indexOf('\n', end + 1) + 1)
  }
  const lines = body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^#{1,6}\s/.test(l) && !/^(```|---|\|)/.test(l))
  const s = lines.join(' ').replace(/!?\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g, '$1').replace(/[*_`>]/g, '').replace(/\s+/g, ' ')
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}
