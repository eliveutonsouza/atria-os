// Gera os ícones do PWA a partir do orb do design (núcleo gradiente + anéis + partículas).
// Rodar: docker run --rm -v $PWD:/w -w /w node:24-slim sh -c "npm i --no-save sharp >/dev/null && node scripts/icons.mjs"
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';

const orb = ({ size, pad, bg, mono = false }) => {
  const c = size / 2;
  const r = (size / 2 - pad) * 0.42;
  const ring = (rx, ry, rot, color, op) =>
    `<ellipse cx="${c}" cy="${c}" rx="${rx}" ry="${ry}" transform="rotate(${rot} ${c} ${c})" fill="none" stroke="${color}" stroke-opacity="${op}" stroke-width="${size / 170}"/>`;
  const dots = Array.from({ length: 26 }, (_, i) => {
    const a = (i / 26) * Math.PI * 2 + (i % 3) * 0.4;
    const rr = r * (1.35 + ((i * 37) % 10) / 14);
    const x = c + Math.cos(a) * rr, y = c + Math.sin(a) * rr * 0.55;
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(size / 260) * (1 + (i % 3) * 0.5)}" fill="${mono ? '#fff' : i % 2 ? '#a68cf7' : '#67d8f2'}" fill-opacity="${0.45 + (i % 4) * 0.12}"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <radialGradient id="bg" cx="50%" cy="38%" r="75%"><stop offset="0" stop-color="#0f1533"/><stop offset=".55" stop-color="#0a0c1d"/><stop offset="1" stop-color="#06070d"/></radialGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#67d8f2" stop-opacity=".35"/><stop offset=".5" stop-color="#a68cf7" stop-opacity=".12"/><stop offset="1" stop-color="#a68cf7" stop-opacity="0"/></radialGradient>
    <radialGradient id="core" cx="40%" cy="36%" r="62%"><stop offset="0" stop-color="#ffffff"/><stop offset=".3" stop-color="#67d8f2"/><stop offset=".72" stop-color="#a68cf7" stop-opacity=".75"/><stop offset="1" stop-color="#a68cf7" stop-opacity="0"/></radialGradient>
  </defs>
  ${bg ? `<rect width="${size}" height="${size}" fill="url(#bg)"/>` : ''}
  ${mono ? '' : `<circle cx="${c}" cy="${c}" r="${r * 2.6}" fill="url(#glow)"/>`}
  ${ring(r * 1.55, r * 0.5, -18, mono ? '#fff' : '#67d8f2', 0.55)}
  ${ring(r * 1.8, r * 0.62, 24, mono ? '#fff' : '#a68cf7', 0.45)}
  ${ring(r * 1.25, r * 1.25, 0, mono ? '#fff' : '#67d8f2', 0.35)}
  ${dots}
  <circle cx="${c}" cy="${c}" r="${r}" fill="${mono ? '#fff' : 'url(#core)'}"/>
  ${mono ? '' : `<ellipse cx="${c}" cy="${c}" rx="${r * 0.55}" ry="${r * 0.2}" transform="rotate(35 ${c} ${c})" fill="none" stroke="#fff" stroke-opacity=".25" stroke-width="${size / 200}"/>`}
</svg>`;
};

mkdirSync('public/icons', { recursive: true });
const out = [
  ['icon-192.png', { size: 192, pad: 10, bg: true }],
  ['icon-512.png', { size: 512, pad: 24, bg: true }],
  ['maskable-512.png', { size: 512, pad: 110, bg: true }], // zona segura de 80% p/ Android
  ['apple-touch-180.png', { size: 180, pad: 14, bg: true }],
  ['favicon-32.png', { size: 32, pad: 0, bg: true }],
  ['badge-96.png', { size: 96, pad: 6, bg: false, mono: true }], // badge monocromático (Android)
  ['monochrome-512.png', { size: 512, pad: 60, bg: false, mono: true }],
];
for (const [name, o] of out) {
  await sharp(Buffer.from(orb(o))).png().toFile(`public/icons/${name}`);
  console.log('ok', name);
}
