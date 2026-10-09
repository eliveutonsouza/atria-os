// API HTTP do atualizador (só na rede interna do compose). Bearer ATRIA_UPDATER_TOKEN em tudo, menos /healthz.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Updater } from './updater.ts';

const MAX_BODY = 16 * 1024;

function send(res: ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

// Compara pelo hash (mesmo tamanho sempre), sem vazar o tamanho do token pelo tempo.
function tokenOk(header: string | undefined, token: string): boolean {
  const m = /^Bearer\s+(.+)$/i.exec(header ?? '');
  if (!m) return false;
  const a = createHash('sha256').update(m[1].trim()).digest();
  const b = createHash('sha256').update(token).digest();
  return timingSafeEqual(a, b);
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) { resolve(null); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        resolve(v && typeof v === 'object' && !Array.isArray(v) ? v : null);
      } catch { resolve(null); }
    });
    req.on('error', () => resolve(null));
  });
}

export function createApi(updater: Updater, token: string): Server {
  return createServer(async (req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    if (req.method === 'GET' && path === '/healthz') return send(res, 200, { ok: true });
    // Sem token configurado o atualizador fica desligado (nunca aceita comando sem autenticação).
    if (!token) return send(res, 503, { error: 'ATRIA_UPDATER_TOKEN não configurado' });
    if (!tokenOk(req.headers.authorization, token)) return send(res, 401, { error: 'não autorizado' });

    if (req.method === 'GET' && path === '/status') return send(res, 200, updater.status());
    if (req.method === 'POST' && path === '/update') {
      const body = await readJson(req);
      if (!body) return send(res, 400, { error: 'corpo inválido' });
      const r = updater.start({ tag: body.tag, commandId: body.commandId, jobId: body.jobId });
      if (r === 'busy') return send(res, 409, { error: 'atualização em andamento' });
      if (r === 'invalid') return send(res, 400, { error: 'tag inválida (use vX.Y.Z) ou pedido incompleto' });
      return send(res, 202, { accepted: true });
    }
    if (req.method === 'POST' && path === '/ack') {
      const body = await readJson(req);
      if (!body || typeof body.commandId !== 'string') return send(res, 400, { error: 'commandId obrigatório' });
      return updater.ack(body.commandId) ? send(res, 200, { ok: true }) : send(res, 404, { error: 'job não encontrado' });
    }
    return send(res, 404, { error: 'não encontrado' });
  });
}
