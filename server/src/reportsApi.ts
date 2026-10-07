import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { ReportPayload } from '../../shared/protocol.ts';
import { config } from './config.ts';

// Relatórios dos agentes (/workspace/.atria/reports/*.json): listar, abrir um anterior e excluir.
// /api/reports/latest continua em index.ts (rota estática ganha da paramétrica).

export interface ReportListItem {
  name: string; // arquivo, ex. 2026-10-06-1430.json
  title: string;
  createdAt: string;
  generatedBy: string;
}

const reportsDir = () => join(config.metaDir, 'reports');

// Só nomes simples de arquivo .json: nada de barra, "..", nem arquivo oculto.
export const validReportName = (name: unknown): name is string => typeof name === 'string' && name.length <= 160 && /^[\w-][\w.-]*\.json$/.test(name) && !name.includes('..');

function parse(name: string): ReportPayload | null {
  try {
    const j = JSON.parse(readFileSync(join(reportsDir(), name), 'utf8'));
    const ts = name.replace(/\.json$/, '');
    return {
      id: ts,
      generatedBy: j.generatedBy ?? 'Report Agent',
      generatedAt: j.generatedAt ?? ts,
      title: String(j.title ?? 'Relatório'),
      lead: String(j.lead ?? ''),
      kpis: Array.isArray(j.kpis) ? j.kpis.slice(0, 4) : [],
      sections: Array.isArray(j.sections) ? j.sections : [],
    };
  } catch {
    return null;
  }
}

export function listReports(): ReportListItem[] {
  if (!existsSync(reportsDir())) return [];
  const out: ReportListItem[] = [];
  for (const name of readdirSync(reportsDir()).filter(validReportName).sort().reverse().slice(0, 200)) {
    const r = parse(name);
    if (!r) continue;
    const created = Number.isNaN(Date.parse(r.generatedAt)) ? statSync(join(reportsDir(), name)).mtime.toISOString() : r.generatedAt;
    out.push({ name, title: r.title, createdAt: created, generatedBy: r.generatedBy });
  }
  return out;
}

export function deleteReport(name: string): boolean {
  if (!validReportName(name)) return false;
  const file = join(reportsDir(), name);
  if (!existsSync(file)) return false;
  rmSync(file);
  return true;
}

export function register(app: FastifyInstance): void {
  app.get('/api/reports', () => listReports());

  app.get('/api/reports/:name', (req, reply) => {
    const { name } = req.params as { name: string };
    if (!validReportName(name)) return reply.code(400).send({ error: 'nome inválido' });
    if (!existsSync(join(reportsDir(), name))) return reply.code(404).send({ error: 'relatório não encontrado' });
    return parse(name) ?? reply.code(422).send({ error: 'relatório ilegível' });
  });

  app.delete('/api/reports/:name', (req, reply) => {
    const { name } = req.params as { name: string };
    if (!validReportName(name)) return reply.code(400).send({ error: 'nome inválido' });
    return deleteReport(name) ? reply.code(204).send() : reply.code(404).send({ error: 'relatório não encontrado' });
  });
}
