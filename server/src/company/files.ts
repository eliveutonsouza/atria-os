// Validação de arquivos enviados: extensão permitida + assinatura real do conteúdo (magic bytes).

export const MAX_FILE = 50 * 1024 * 1024;

const KINDS: Record<string, { mime: string; from: string; sig: (b: Buffer) => boolean }> = {
  pdf: { mime: 'application/pdf', from: 'pdf', sig: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', from: 'docx', sig: zip },
  pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', from: 'pptx', sig: zip },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', from: 'xlsx', sig: zip },
  odt: { mime: 'application/vnd.oasis.opendocument.text', from: 'odt', sig: zip },
  doc: { mime: 'application/msword', from: 'doc', sig: ole },
  xls: { mime: 'application/vnd.ms-excel', from: 'xls', sig: ole },
  ppt: { mime: 'application/vnd.ms-powerpoint', from: 'ppt', sig: ole },
  png: { mime: 'image/png', from: 'image', sig: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  jpg: { mime: 'image/jpeg', from: 'image', sig: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  jpeg: { mime: 'image/jpeg', from: 'image', sig: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  webp: { mime: 'image/webp', from: 'image', sig: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
  tif: { mime: 'image/tiff', from: 'image', sig: tiff },
  tiff: { mime: 'image/tiff', from: 'image', sig: tiff },
  md: { mime: 'text/markdown', from: 'md', sig: text },
  txt: { mime: 'text/plain', from: 'md', sig: text },
  csv: { mime: 'text/csv', from: 'csv', sig: text },
};

function zip(b: Buffer) {
  return b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
}
function ole(b: Buffer) {
  return b.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
}
function tiff(b: Buffer) {
  const h = b.subarray(0, 4).toString('latin1');
  return h === 'II*\0' || h === 'MM\0*';
}
function text(b: Buffer) {
  return !b.subarray(0, 4096).includes(0);
}

export const ACCEPTED = Object.keys(KINDS);

export function extOf(name: string): string {
  const m = name.toLowerCase().match(/\.([a-z0-9]{1,5})$/);
  return m ? m[1] : '';
}

// Nome exibido: sem caminho, sem caracteres de controle, até 160 caracteres.
export function cleanName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'arquivo';
  // eslint-disable-next-line no-control-regex
  const c = base.replace(/[\u0000-\u001f\u007f<>:"|?*]+/g, ' ').replace(/\s+/g, ' ').trim();
  return (c || 'arquivo').slice(0, 160);
}

export function checkFile(name: string, head: Buffer): { ok: true; ext: string; mime: string; from: string } | { ok: false; reason: string } {
  const ext = extOf(name);
  const k = KINDS[ext];
  if (!k) return { ok: false, reason: `tipo .${ext || '?'} não aceito` };
  if (!head.length) return { ok: false, reason: 'arquivo vazio' };
  if (!k.sig(head)) return { ok: false, reason: `o conteúdo não parece um .${ext} de verdade` };
  return { ok: true, ext, mime: k.mime, from: k.from };
}

export const doclingFormat = (ext: string) => KINDS[ext]?.from ?? null;
export const mimeOf = (ext: string) => KINDS[ext]?.mime ?? 'application/octet-stream';
