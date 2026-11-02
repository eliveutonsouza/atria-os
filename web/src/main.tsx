import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles/tokens.css'
import { initPwa } from './pwa/pwa'
import { setAssistantName } from './lib/assistant'

initPwa()

// O nome vem do servidor (rota pública, também na tela de login) antes de montar; se demorar, abre com o padrão.
async function loadName() {
  try {
    const r = await fetch('/api/setup/status', { signal: AbortSignal.timeout(2500) })
    if (r.ok) setAssistantName(((await r.json()) as { assistantName?: string }).assistantName)
  } catch {
    /* segue com o padrão */
  }
}

void loadName().finally(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
)
