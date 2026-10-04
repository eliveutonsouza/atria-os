import type { AppPage } from '@shared/protocol'
import type { ComponentType } from 'react'
import { AgentsPage } from './AgentsPage'
import { BrowserPage } from './BrowserPage'
import { ClaudePage } from './ClaudePage'
import { InboxPage } from './InboxPage'
import { InfraPage } from './InfraPage'
import { MissionsPage } from './MissionsPage'
import { OpsPage } from './OpsPage'
import { OverviewPage } from './OverviewPage'
import { ProjectsPage } from './ProjectsPage'
import { RunsPage } from './RunsPage'
import { SchedulePage } from './SchedulePage'
import { SettingsPage } from './SettingsPage'
import { TerminalPage } from './TerminalPage'
import { ToolsPage } from './ToolsPage'
import { WorkflowsPage } from './WorkflowsPage'
import { VaultPage } from './VaultPage'
import { BrainPage } from './BrainPage'

// Registro das páginas do dashboard (/app/<página>). Cada página lê `appParams.id` quando tem detalhe.
export const PAGES: Record<AppPage, ComponentType> = {
  overview: OverviewPage,
  ops: OpsPage,
  agents: AgentsPage,
  runs: RunsPage,
  missions: MissionsPage,
  workflows: WorkflowsPage,
  schedule: SchedulePage,
  projects: ProjectsPage,
  browser: BrowserPage,
  terminal: TerminalPage,
  claude: ClaudePage,
  tools: ToolsPage,
  inbox: InboxPage,
  infra: InfraPage,
  settings: SettingsPage,
  vault: VaultPage,
  brain: BrainPage,
}
