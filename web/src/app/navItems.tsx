import type { AppPage, OpsBoard } from '@shared/protocol'
import { useApi } from '../api/useApi'
import { useYui } from '../store/yui'

// Itens e ícones do menu do dashboard: compartilhados por Sidebar (desktop), rail (tablet), abas e "Mais" (celular).

export const NAV_ICON: Record<AppPage, string> = {
  overview: 'M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z',
  ops: 'M4 6h16M4 12h10M4 18h6M18 15l3 3-3 3',
  agents: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM16 11a3 3 0 1 0 0-6M2 20c0-3 3-5 6-5s6 2 6 5M16 15c3 0 6 2 6 5',
  runs: 'M5 4l14 8-14 8z',
  missions: 'M12 3l2.5 5 5.5.8-4 3.9.9 5.5L12 15.6 7.1 18.2 8 12.7 4 8.8l5.5-.8z',
  workflows: 'M6 3v6M6 15v6M18 9v6M6 9a3 3 0 1 0 0 6M18 9a3 3 0 1 0 0-6M9 12h6',
  schedule: 'M4 6h16v14H4zM4 10h16M9 3v4M15 3v4',
  projects: 'M3 7h7l2 2h9v10H3z',
  browser: 'M3 5h18v14H3zM3 9h18M7 7h.01M10 7h.01',
  terminal: 'M4 5h16v14H4zM8 10l2 2-2 2M12 15h4',
  claude: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6',
  tools: 'M14 7l3-3 3 3-3 3M4 20l9-9M10 4a4 4 0 0 0 5 5',
  inbox: 'M4 13l2-8h12l2 8M4 13v6h16v-6M4 13h5l1 2h4l1-2h5',
  infra: 'M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01',
  company: 'M4 21V7l8-4 8 4v14M9 21v-6h6v6M8 10h.01M12 10h.01M16 10h.01',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01',
  vault: 'M5 4h5v16H5zM10 4h4v16h-4zM15.5 5.2l3.8 1-3.4 13.6-3.8-1z',
  brain: 'M5 7.5a1.5 1.5 0 1 0 0-.01M18.5 5a1.5 1.5 0 1 0 0-.01M12 12.5a2 2 0 1 0 0-.01M6.5 19a1.5 1.5 0 1 0 0-.01M19 18a1.5 1.5 0 1 0 0-.01M6.3 8.4l4 3M17.4 6.2l-4 4.6M10.6 13.8l-3 3.8M13.6 13.6l4 3.2',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z',
  more: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
}

export type NavItem = { id: AppPage; label: string; count?: number; warn?: boolean }

/** Grupos do menu com contadores ao vivo (rodando, agentes, aprovações, missões, workflows). */
export function useNavGroups(active = true): { name: string; items: NavItem[] }[] {
  const inbox = useYui((s) => s.inbox)
  const working = useYui((s) => s.agentsWorking)
  const missions = useYui((s) => s.missions)
  const board = useApi<OpsBoard>(active ? '/api/ops/board' : null, [active], 15000)
  const p = board.data?.pipeline
  const activeMissions = p?.missions ?? Object.values(missions).filter((m) => m.status === 'running' || m.status === 'paused' || m.status === 'blocked').length
  return [
    {
      name: 'Acompanhar',
      items: [
        { id: 'overview', label: 'Visão geral' },
        { id: 'ops', label: 'Operações', count: p ? p.running + p.queued : undefined },
        { id: 'agents', label: 'Agentes', count: working || undefined },
        { id: 'runs', label: 'Execuções' },
        { id: 'inbox', label: 'Aprovações', count: inbox.length || undefined, warn: true },
      ],
    },
    {
      name: 'Organizar',
      items: [
        { id: 'missions', label: 'Missões', count: activeMissions || undefined },
        { id: 'workflows', label: 'Workflows', count: p?.workflows || undefined },
        { id: 'schedule', label: 'Agendamentos' },
        { id: 'projects', label: 'Projetos' },
      ],
    },
    {
      name: 'Conhecimento',
      items: [
        { id: 'company', label: 'Empresa' },
        { id: 'vault', label: 'Vault' },
        { id: 'brain', label: 'Cérebro' },
      ],
    },
    {
      name: 'Ferramentas',
      items: [
        { id: 'browser', label: 'Navegador' },
        { id: 'terminal', label: 'Terminal' },
        { id: 'claude', label: 'Claude Code' },
        { id: 'tools', label: 'Conectores & MCP' },
      ],
    },
    { name: 'Sistema', items: [{ id: 'infra', label: 'Infra & logs' }, { id: 'settings', label: 'Configurações' }, { id: 'help', label: 'Ajuda' }] },
  ]
}

export function NavIcon({ id, size = 16, stroke = 1.6 }: { id: AppPage; size?: number; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={NAV_ICON[id]} />
    </svg>
  )
}
