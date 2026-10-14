// Prototype: render three annotation styles onto a real agent-device capture.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { initWasm, Resvg } from '@resvg/resvg-wasm';

const require = createRequire(import.meta.url);
await initWasm(readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm')));

const font = (w) => readFileSync(require.resolve(`@expo-google-fonts/inter/${w}/Inter_${w}.ttf`));
const fontBuffers = [font('400Regular'), font('600SemiBold'), font('700Bold')];

const snapshot = JSON.parse(readFileSync('home.snapshot.json', 'utf8')).data;
const raw = readFileSync('home.raw.png');
const D = 3; // pixel density
const W = 1179;
const H = 2556;
const pt = (v) => v * D;

// Selector stand-in: exact label, smallest-area match (mimics the RN double-report merge).
function find(pred) {
  const m = snapshot.nodes.filter((n) => n.rect && pred(n));
  if (!m.length) throw new Error('no match');
  m.sort((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height);
  const r = m[0].rect;
  return { x: pt(r.x), y: pt(r.y), w: pt(r.width), h: pt(r.height), label: m[0].label };
}
const byLabel = (l) => find((n) => n.label === l);
const nth = (l, i) => {
  const m = snapshot.nodes.filter((n) => n.rect && n.label === l);
  m.sort((a, b) => a.rect.y - b.rect.y || a.rect.width * a.rect.height - b.rect.width * b.rect.height);
  const r = m[i].rect;
  return { x: pt(r.x), y: pt(r.y), w: pt(r.width), h: pt(r.height) };
};

const T = {
  register: byLabel('Register'),
  viewAll: nth('View All', 1), // smaller "View All" of the Popular row
  game: byLabel('Floating Dragon Megaways'),
  deposit: byLabel('Deposit'),
  marquee: find((n) => n.index === 18), // unlabeled in the app; a testID would be needed
};

const criterion = 'Logged-out home shows Register, Popular games and a Wallet tab';
const notes = [
  { n: 1, t: T.register, kind: 'pass', text: 'Register is visible', detail: 'visible' },
  { n: 2, t: T.viewAll, kind: 'info', text: 'Opens the full Popular list', arrow: true },
  { n: 3, t: T.game, kind: 'pass', text: 'First Popular game', detail: 'text = "Floating Dragon Megaways"' },
  { n: 4, t: T.deposit, kind: 'fail', text: 'Tab label', detail: 'expected "Wallet", got "Deposit"' },
];

const C = { info: '#2F7CF6', pass: '#16A34A', fail: '#E5323E', ink: '#0B1220', paper: '#FFFFFF', mask: '#1F2430' };
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Rough Inter advance width; the real package would measure glyphs.
const textW = (s, size, weight = 600) => s.length * size * (weight >= 600 ? 0.6 : 0.56);

const icon = (kind, cx, cy, r) => {
  if (kind === 'pass') return `<path d="M${cx - r * 0.45} ${cy} l${r * 0.3} ${r * 0.32} l${r * 0.6} ${-r * 0.65}" fill="none" stroke="#fff" stroke-width="${r * 0.28}" stroke-linecap="round" stroke-linejoin="round"/>`;
  if (kind === 'fail') return `<path d="M${cx - r * 0.38} ${cy - r * 0.38} L${cx + r * 0.38} ${cy + r * 0.38} M${cx + r * 0.38} ${cy - r * 0.38} L${cx - r * 0.38} ${cy + r * 0.38}" stroke="#fff" stroke-width="${r * 0.28}" stroke-linecap="round"/>`;
  return '';
};

function pill(x, y, text, color, size, { anchor = 'start', icon: ic } = {}) {
  const padX = size * 0.6;
  const iconW = ic ? size * 1.1 : 0;
  const w = textW(text, size) + padX * 2 + iconW;
  const h = size * 1.8;
  const left = anchor === 'end' ? x - w : x;
  const clampedLeft = Math.max(pt(6), Math.min(left, W - w - pt(6)));
  const ty = y + h / 2 + size * 0.36;
  return `
  <g filter="url(#shadow)">
    <rect x="${clampedLeft}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${color}"/>
  </g>
  ${ic ? icon(ic, clampedLeft + padX + size * 0.4, y + h / 2, size * 0.75) : ''}
  <text x="${clampedLeft + padX + iconW}" y="${ty}" font-family="Inter" font-weight="600" font-size="${size}" fill="#fff">${esc(text)}</text>`;
}

const defs = `
<defs>
  <filter id="shadow" x="-20%" y="-20%" width="140%" height="160%">
    <feDropShadow dx="0" dy="${pt(1)}" stdDeviation="${pt(1.5)}" flood-color="#000" flood-opacity="0.45"/>
  </filter>
  <pattern id="hatch" width="${pt(6)}" height="${pt(6)}" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
    <rect width="${pt(6)}" height="${pt(6)}" fill="${C.mask}"/>
    <line x1="0" y1="0" x2="0" y2="${pt(6)}" stroke="#3A4152" stroke-width="${pt(2.5)}"/>
  </pattern>
  ${['info', 'pass', 'fail'].map((k) => `<marker id="head-${k}" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="${C[k]}"/></marker>`).join('')}
</defs>`;

const shot = `<image href="data:image/png;base64,${raw.toString('base64')}" x="0" y="0" width="${W}" height="${H}"/>`;

const mask = (t, y0 = 0) => `
  <rect x="${t.x}" y="${t.y + y0}" width="${t.w}" height="${t.h}" fill="url(#hatch)"/>
  <text x="${t.x + t.w / 2}" y="${t.y + y0 + t.h / 2 + pt(4)}" text-anchor="middle" font-family="Inter" font-weight="600" font-size="${pt(11)}" fill="#C9CED8">masked</text>`;

function header(title, y0, failed) {
  const status = failed ? 'FAILED' : 'PASSED';
  const color = failed ? C.fail : C.pass;
  return `
  <rect x="0" y="0" width="${W}" height="${y0}" fill="${C.paper}"/>
  <rect x="${pt(16)}" y="${pt(16)}" width="${textW(status, pt(11), 700) + pt(16)}" height="${pt(22)}" rx="${pt(11)}" fill="${color}"/>
  <text x="${pt(24)}" y="${pt(31)}" font-family="Inter" font-weight="700" font-size="${pt(11)}" fill="#fff">${status}</text>
  <text x="${pt(16)}" y="${pt(62)}" font-family="Inter" font-weight="600" font-size="${pt(15)}" fill="${C.ink}">${esc(title)}</text>
  <text x="${pt(16)}" y="${pt(82)}" font-family="Inter" font-weight="400" font-size="${pt(11)}" fill="#5B6475">step: home · iPhone 15 Pro · iOS 18.4 · 3 of 4 checks passed</text>`;
}

// Style A: bold, Shottr-like. Thick rounded boxes, pills next to targets, haloed arrow.
function styleA() {
  const y0 = pt(96);
  let out = header(criterion, y0, true) + `<g transform="translate(0 ${y0})">` + shot + mask(T.marquee);
  for (const a of notes) {
    const { t } = a;
    const color = C[a.kind];
    const sw = pt(3);
    if (!a.arrow) out += `<rect x="${t.x - pt(3)}" y="${t.y - pt(3)}" width="${t.w + pt(6)}" height="${t.h + pt(6)}" rx="${pt(8)}" fill="none" stroke="#fff" stroke-width="${sw + pt(2)}" opacity="0.9"/><rect x="${t.x - pt(3)}" y="${t.y - pt(3)}" width="${t.w + pt(6)}" height="${t.h + pt(6)}" rx="${pt(8)}" fill="none" stroke="${color}" stroke-width="${sw}"/>`;
    const label = a.detail ? `${a.text}: ${a.detail}` : a.text;
    if (a.arrow) {
      const ex = t.x + t.w / 2;
      const ey = t.y + t.h + pt(4);
      const sx = ex - pt(60);
      const sy = ey + pt(70);
      out += `<path d="M${sx} ${sy} Q ${sx + pt(10)} ${ey + pt(10)} ${ex} ${ey}" fill="none" stroke="#fff" stroke-width="${pt(7)}" stroke-linecap="round"/>`;
      out += `<path d="M${sx} ${sy} Q ${sx + pt(10)} ${ey + pt(10)} ${ex} ${ey}" fill="none" stroke="${color}" stroke-width="${pt(4)}" stroke-linecap="round" marker-end="url(#head-info)"/>`;
      out += pill(sx, sy, label, color, pt(12), { anchor: 'end' });
    } else {
      const below = t.y + t.h + pt(8);
      const above = t.y - pt(8) - pt(12) * 1.8;
      const y = t.y > H * 0.75 ? above : below;
      out += pill(t.x, y, label, color, pt(12), { icon: a.kind === 'info' ? undefined : a.kind });
    }
  }
  return { svg: out + '</g>', h: H + y0 };
}

// Style B: inspector. Spotlight dims everything except targets; thin boxes with corner tags.
function styleB() {
  const y0 = pt(96);
  const holes = notes.map(({ t }) => `<rect x="${t.x - pt(4)}" y="${t.y - pt(4)}" width="${t.w + pt(8)}" height="${t.h + pt(8)}" rx="${pt(6)}" fill="#000"/>`).join('');
  let out = header(criterion, y0, true) + `<g transform="translate(0 ${y0})">` + shot + mask(T.marquee);
  out += `<mask id="spot"><rect width="${W}" height="${H}" fill="#fff"/>${holes}</mask><rect width="${W}" height="${H}" fill="#000" opacity="0.55" mask="url(#spot)"/>`;
  for (const a of notes) {
    const { t } = a;
    const color = C[a.kind];
    out += `<rect x="${t.x - pt(4)}" y="${t.y - pt(4)}" width="${t.w + pt(8)}" height="${t.h + pt(8)}" rx="${pt(6)}" fill="none" stroke="${color}" stroke-width="${pt(1.5)}"/>`;
    const label = `${a.n}  ${a.detail ? `${a.text} · ${a.detail}` : a.text}`;
    const size = pt(10.5);
    const h = size * 1.7;
    const w = textW(label, size) + pt(12);
    const fitsAbove = t.y - pt(4) - h > pt(4);
    const y = fitsAbove ? t.y - pt(4) - h : t.y + t.h + pt(4);
    const x = Math.max(pt(4), Math.min(t.x - pt(4), W - w - pt(4)));
    out += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${pt(3)}" fill="${color}"/><text x="${x + pt(6)}" y="${y + h / 2 + size * 0.36}" font-family="Inter" font-weight="600" font-size="${size}" fill="#fff">${esc(label)}</text>`;
  }
  return { svg: out + '</g>', h: H + y0 };
}

// Style C: numbered markers on the screen, all text in a legend panel below. Nothing covers the UI.
function styleC() {
  const legendRow = pt(46);
  const legendH = pt(84) + notes.length * legendRow + pt(16);
  let out = `<rect x="0" y="0" width="${W}" height="${H + legendH}" fill="${C.paper}"/>` + shot + mask(T.marquee);
  for (const a of notes) {
    const { t } = a;
    const color = C[a.kind];
    out += `<rect x="${t.x - pt(3)}" y="${t.y - pt(3)}" width="${t.w + pt(6)}" height="${t.h + pt(6)}" rx="${pt(6)}" fill="none" stroke="#fff" stroke-width="${pt(4)}" opacity="0.85"/><rect x="${t.x - pt(3)}" y="${t.y - pt(3)}" width="${t.w + pt(6)}" height="${t.h + pt(6)}" rx="${pt(6)}" fill="none" stroke="${color}" stroke-width="${pt(2.5)}"/>`;
    const r = pt(12);
    const cx = Math.max(r + pt(2), t.x - pt(3));
    const cy = Math.max(r + pt(2), t.y - pt(3));
    out += `<g filter="url(#shadow)"><circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" stroke="#fff" stroke-width="${pt(2)}"/></g><text x="${cx}" y="${cy + pt(5)}" text-anchor="middle" font-family="Inter" font-weight="700" font-size="${pt(14)}" fill="#fff">${a.n}</text>`;
  }
  const ly = H;
  out += `<rect x="0" y="${ly}" width="${W}" height="${legendH}" fill="${C.paper}"/><line x1="0" y1="${ly}" x2="${W}" y2="${ly}" stroke="#E3E6EC" stroke-width="${pt(1)}"/>`;
  out += `<rect x="${pt(16)}" y="${ly + pt(16)}" width="${textW('FAILED', pt(11), 700) + pt(16)}" height="${pt(22)}" rx="${pt(11)}" fill="${C.fail}"/><text x="${pt(24)}" y="${ly + pt(31)}" font-family="Inter" font-weight="700" font-size="${pt(11)}" fill="#fff">FAILED</text>`;
  out += `<text x="${pt(16)}" y="${ly + pt(62)}" font-family="Inter" font-weight="600" font-size="${pt(15)}" fill="${C.ink}">${esc(criterion)}</text>`;
  notes.forEach((a, i) => {
    const y = ly + pt(84) + i * legendRow;
    const color = C[a.kind];
    out += `<circle cx="${pt(30)}" cy="${y + pt(16)}" r="${pt(11)}" fill="${color}"/><text x="${pt(30)}" y="${y + pt(21)}" text-anchor="middle" font-family="Inter" font-weight="700" font-size="${pt(13)}" fill="#fff">${a.n}</text>`;
    out += `<text x="${pt(52)}" y="${y + pt(14)}" font-family="Inter" font-weight="600" font-size="${pt(13)}" fill="${C.ink}">${esc(a.text)}</text>`;
    const sub = a.kind === 'fail' ? `✗ ${a.detail}` : a.kind === 'pass' ? `✓ ${a.detail}` : 'note';
    out += `<text x="${pt(52)}" y="${y + pt(32)}" font-family="Inter" font-weight="400" font-size="${pt(11.5)}" fill="${a.kind === 'fail' ? C.fail : '#5B6475'}">${esc(sub)}</text>`;
  });
  return { svg: out, h: H + legendH };
}

const outputs = {};
for (const [name, fn] of Object.entries({ A: styleA, B: styleB, C: styleC })) {
  const { svg, h } = fn();
  const doc = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}" viewBox="0 0 ${W} ${h}">${defs}${svg}</svg>`;
  const t0 = performance.now();
  const png = new Resvg(doc, { font: { fontBuffers, loadSystemFonts: false, defaultFontFamily: 'Inter' } }).render().asPng();
  const ms = Math.round(performance.now() - t0);
  writeFileSync(`style-${name}.png`, png);
  outputs[name] = { h, ms, bytes: png.length };
}
console.log(JSON.stringify(outputs));
