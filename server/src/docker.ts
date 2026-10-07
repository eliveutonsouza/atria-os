import { config } from './config.ts';

// Cliente mínimo do docker-socket-proxy (somente leitura: CONTAINERS=1, INFO=1).

export interface ContainerSummary {
  name: string;
  state: string;
  status: string;
  health: string | null;
}

export async function dget(path: string): Promise<Response> {
  return fetch(`${config.dockerApi}${path}`, { signal: AbortSignal.timeout(5000) });
}

export async function listContainers(): Promise<ContainerSummary[]> {
  const r = await dget('/containers/json?all=1');
  if (!r.ok) throw new Error(`docker ${r.status}`);
  const list = (await r.json()) as { Names: string[]; State: string; Status: string }[];
  return list.map((c) => {
    const health = /\((healthy|unhealthy|health: starting)\)/.exec(c.Status)?.[1] ?? null;
    return { name: c.Names[0]?.replace(/^\//, '') ?? '?', state: c.State, status: c.Status, health };
  });
}

// Logs: stream multiplexado (header de 8 bytes por frame) quando o container não usa TTY.
export async function containerLogs(name: string, tail = 200): Promise<string[]> {
  const r = await dget(`/containers/${encodeURIComponent(name)}/logs?stdout=1&stderr=1&timestamps=1&tail=${tail}`);
  if (!r.ok) throw new Error(`docker logs ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const out: string[] = [];
  let i = 0;
  const muxed = buf.length >= 8 && (buf[0] === 1 || buf[0] === 2) && buf[1] === 0 && buf[2] === 0 && buf[3] === 0;
  if (!muxed) return buf.toString('utf8').split('\n').filter(Boolean);
  while (i + 8 <= buf.length) {
    const len = buf.readUInt32BE(i + 4);
    out.push(...buf.subarray(i + 8, i + 8 + len).toString('utf8').split('\n').filter(Boolean));
    i += 8 + len;
  }
  return out;
}
