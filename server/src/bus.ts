import type { ServerResponse } from 'node:http';
import type { ServerEvent, YuiState } from '../../shared/protocol.ts';

// Barramento SSE: um único usuário, mas várias abas/dispositivos podem estar abertos.
const clients = new Set<ServerResponse>();

export function addClient(res: ServerResponse): () => void {
  clients.add(res);
  return () => clients.delete(res);
}

export function emit(ev: ServerEvent): void {
  const payload = `data: ${JSON.stringify(ev)}\n\n`;
  for (const res of clients) res.write(payload);
}

let currentState: YuiState = 'idle';
export function setYuiState(state: YuiState): void {
  if (state === currentState) return;
  currentState = state;
  emit({ type: 'yui.state', state });
}
export const yuiState = () => currentState;

setInterval(() => emit({ type: 'ping' }), 25_000).unref();
