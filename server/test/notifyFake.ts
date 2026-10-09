// Telegram e Resend falsos para os testes de notify (fetch injetado com setNotifyFetch).
export interface Call { url: string; method: string; body: unknown; headers: Record<string, string> }

export function fakeFetch() {
  const calls: Call[] = [];
  let nextId = 100;
  const state = {
    calls,
    files: new Map<string, { size: number; data: Buffer }>(), // file_id → conteúdo
    updates: [] as unknown[][], // respostas sucessivas de getUpdates
    resendStatus: 200,
    failTelegram: false,
    clear: () => (calls.length = 0),
    tg: (method: string) => calls.filter((c) => c.url.includes('api.telegram.org/bot') && c.url.endsWith(`/${method}`)),
    resend: () => calls.filter((c) => c.url.startsWith('https://api.resend.com')),
  };
  const json = (j: unknown, status = 200) => new Response(JSON.stringify(j), { status, headers: { 'content-type': 'application/json' } });
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const raw = init?.body;
    const body = typeof raw === 'string' ? JSON.parse(raw) : raw;
    calls.push({ url, method: init?.method ?? 'GET', body, headers: (init?.headers ?? {}) as Record<string, string> });
    if (url.startsWith('https://api.resend.com')) {
      return state.resendStatus < 300 ? json({ id: 'em_1' }) : json({ message: 'domínio não verificado' }, state.resendStatus);
    }
    if (url.includes('api.telegram.org/file/bot')) {
      const id = url.split('/').at(-1)!;
      const f = state.files.get(id);
      return f ? new Response(new Uint8Array(f.data)) : new Response('nope', { status: 404 });
    }
    if (state.failTelegram) throw new Error('rede fora');
    const method = url.split('/').at(-1)!;
    if (method === 'sendMessage' || method === 'sendPhoto' || method === 'sendDocument') return json({ ok: true, result: { message_id: nextId++ } });
    if (method === 'getFile') {
      const f = state.files.get((body as { file_id: string }).file_id);
      return f ? json({ ok: true, result: { file_path: (body as { file_id: string }).file_id, file_size: f.size } }) : json({ ok: false, error_code: 400, description: 'file not found' }, 400);
    }
    if (method === 'getMe') return json({ ok: true, result: { username: 'atria_teste_bot' } });
    if (method === 'getUpdates') {
      const next = state.updates.shift();
      if (next) return json({ ok: true, result: next });
      await new Promise((r) => setTimeout(r, 20));
      return json({ ok: true, result: [] });
    }
    return json({ ok: true, result: true });
  }) as typeof fetch;
  return { state, fetchImpl };
}
