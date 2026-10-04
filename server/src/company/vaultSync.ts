import type { CompanyDoc, CompanyProfile } from '../../../shared/protocol.ts';
import { removeNote, upsertNote } from '../vault.ts';
import { q } from './store.ts';

// Espelho no vault: o perfil vira Empresa/Empresa.md (hub) e cada documento pronto vira
// Empresa/<Categoria>/<nome>.md, ligado ao hub — assim aparecem no Cérebro, na galáxia Empresa.

const safe = (s: string) =>
  s
    .replace(/\.[a-z0-9]{1,5}$/i, '')
    .replace(/[\\/:*?"<>|#^[\]\n\r\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90)
    .replace(/[.\s]+$/, '') || 'documento';

export const docNotePath = (d: Pick<CompanyDoc, 'name' | 'category'>) => `Empresa/${d.category}/${safe(d.name)}.md`;

export async function writeDocNote(d: CompanyDoc) {
  const path = docNotePath(d);
  const old = (await q<{ vault_note: string | null }>(`SELECT vault_note FROM documents WHERE id = $1`, [d.id])).rows[0]?.vault_note;
  if (old && old !== path) removeDocNote(old);
  const lines = [
    '---',
    'tipo: documento da empresa',
    `categoria: ${d.category}`,
    d.docType ? `documento: ${d.docType}` : null,
    `arquivo: ${d.name}`,
    `id: ${d.id}`,
    `tags: [empresa${d.tags.length ? `, ${d.tags.join(', ')}` : ''}]`,
    '---',
    `# ${safe(d.name)}`,
    '',
    `Parte de [[Empresa]] · ${d.category} · ${d.pages} ${d.pages === 1 ? 'página' : 'páginas'}`,
    '',
    '## Resumo',
    d.summary ?? '(sem resumo)',
    d.fields.length ? `\n## Campos\n${d.fields.map((f) => `- **${f.key}:** ${f.value}`).join('\n')}` : null,
    d.entities.length ? `\n## Entidades\n${d.entities.map((e) => `- ${e.type}: ${e.value}`).join('\n')}` : null,
    '',
    '> Nota gerada a partir da base de documentos (Empresa › Documentos). O texto completo fica na busca da Yui e dos agentes.',
    '',
  ].filter((l) => l !== null);
  upsertNote(path, lines.join('\n'));
  await q(`UPDATE documents SET vault_note = $2 WHERE id = $1`, [d.id, path]);
}

export function removeDocNote(path: string) {
  try {
    removeNote(path);
  } catch {
    /* já não existe */
  }
}

export function writeProfileNote(p: CompanyProfile) {
  const services = p.services.filter((s) => s.name.trim());
  const body = [
    '---',
    'tipo: empresa',
    'tags: [empresa]',
    '---',
    `# ${p.name || 'Empresa'}`,
    '',
    p.about || '(descreva o que a empresa faz em Empresa › Perfil)',
    '',
    p.audience ? `**Para quem:** ${p.audience}` : null,
    p.segment ? `**Segmento:** ${p.segment}` : null,
    p.tone ? `**Tom de voz:** ${p.tone}` : null,
    p.site ? `**Site:** ${p.site}` : null,
    p.city ? `**Atendimento:** ${p.city}` : null,
    services.length ? `\n## Serviços e preços\n${services.map((s) => `- ${s.name}${s.price ? ` — ${s.price}` : ''}`).join('\n')}` : null,
    '',
    'Documentos da empresa ficam nas subpastas desta (Comercial, Contratos, Marca, Processos, Financeiro, Clientes) e ligam aqui.',
    '',
    'Relacionadas: [[Yui Console]]',
    '',
  ].filter((l) => l !== null);
  upsertNote('Empresa/Empresa.md', body.join('\n'));
}
