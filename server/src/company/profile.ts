import type { CompanyProfile, CompanyProfileInput } from '../../../shared/protocol.ts';
import { q } from './store.ts';

// Perfil da empresa: guardado no Postgres e mantido em memória — entra (sincrono) no prompt de
// toda execução de agente e no contexto da Yui.

const EMPTY: CompanyProfileInput = { name: '', legalName: '', cnpj: '', segment: '', site: '', city: '', about: '', audience: '', tone: '', services: [] };

let cached: CompanyProfile = { ...EMPTY, hasLogo: false, logoVersion: 0, updatedAt: null, agentPreview: '' };
let docCount = 0;
let chunkCount = 0;

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function sanitizeProfile(b: unknown): CompanyProfileInput {
  const o = (b ?? {}) as Record<string, unknown>;
  const services = Array.isArray(o.services) ? o.services : [];
  return {
    name: str(o.name, 120),
    legalName: str(o.legalName, 160),
    cnpj: str(o.cnpj, 24),
    segment: str(o.segment, 80),
    site: str(o.site, 200),
    city: str(o.city, 120),
    about: str(o.about, 1500),
    audience: str(o.audience, 800),
    tone: str(o.tone, 200),
    services: services
      .slice(0, 40)
      .map((s) => ({ name: str((s as Record<string, unknown>)?.name, 120), price: str((s as Record<string, unknown>)?.price, 60) }))
      .filter((s) => s.name),
  };
}

// Texto exato que os agentes e a Yui recebem.
export function buildPreview(p: CompanyProfileInput, docs = docCount, chunks = chunkCount): string {
  if (!p.name && !p.about) return '';
  return [
    `# Empresa: ${p.name || '(sem nome)'}${p.legalName ? ` (${p.legalName})` : ''}`,
    p.segment ? `Segmento: ${p.segment}` : null,
    p.about ? `O que faz: ${p.about}` : null,
    p.audience ? `Para quem: ${p.audience}` : null,
    p.services.length ? `Serviços: ${p.services.map((s) => `${s.name}${s.price ? ` (${s.price})` : ''}`).join('; ')}` : null,
    p.tone ? `Tom de voz: ${p.tone}` : null,
    p.site ? `Site: ${p.site}` : null,
    p.city ? `Atendimento: ${p.city}` : null,
    `Base de documentos: empresa_consultar("pergunta") → ${docs} ${docs === 1 ? 'documento' : 'documentos'}, ${chunks} trechos`,
  ]
    .filter(Boolean)
    .join('\n');
}

export async function loadProfile(): Promise<CompanyProfile> {
  const r = (await q<{ data: CompanyProfileInput; logo_ext: string | null; logo_version: number; updated_at: Date | null }>(`SELECT data, logo_ext, logo_version, updated_at FROM company_profile WHERE id = 1`)).rows[0];
  const c = (await q<{ d: string; c: string }>(`SELECT COUNT(*) AS d, COALESCE(SUM(chunks), 0) AS c FROM documents WHERE state = 'ready'`)).rows[0];
  docCount = Number(c.d);
  chunkCount = Number(c.c);
  const input = { ...EMPTY, ...(r?.data ?? {}) };
  cached = { ...input, hasLogo: !!r?.logo_ext, logoVersion: r?.logo_version ?? 0, updatedAt: r?.updated_at?.toISOString() ?? null, agentPreview: buildPreview(input) };
  return cached;
}

export async function saveProfile(input: CompanyProfileInput): Promise<CompanyProfile> {
  await q(
    `INSERT INTO company_profile(id, data, updated_at) VALUES(1, $1, now())
     ON CONFLICT (id) DO UPDATE SET data = excluded.data, updated_at = now()`,
    [JSON.stringify(input)],
  );
  return loadProfile();
}

export async function setLogo(ext: string | null) {
  await q(
    `INSERT INTO company_profile(id, logo_ext, logo_version, updated_at) VALUES(1, $1, 1, now())
     ON CONFLICT (id) DO UPDATE SET logo_ext = $1, logo_version = company_profile.logo_version + 1, updated_at = now()`,
    [ext],
  );
  return loadProfile();
}

export const profile = () => cached;
export const logoExt = async () => (await q<{ logo_ext: string | null }>(`SELECT logo_ext FROM company_profile WHERE id = 1`)).rows[0]?.logo_ext ?? null;
