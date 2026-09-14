// build-mark.mjs — build the clean Aidit OS mark SVG from fitted params (docs/brand/logo/aidit-os-mark.params.json).
// usage: node scripts/design/build-mark.mjs <params.json> <out.svg> [brand|faithful|mask|mono:#hex|inverse]
// Module: buildMark(P, mode, gid) -> { defs, body, w, h }
import fs from 'node:fs';
export const PALETTES = {
  brand: [[0, '#E9CC7E'], [0.35, '#C6A860'], [0.72, '#5E6B45'], [1, '#1E5A46']],
  faithful: [[0, '#FFC04A'], [0.2, '#F2B642'], [0.42, '#BA963E'], [0.56, '#A68E35'], [0.72, '#777132'], [0.87, '#4A552A'], [1, '#233C25']],
  inverse: [[0, '#2E7A5E'], [0.55, '#1E5A46'], [1, '#12241C']],
};
export function buildMark(P, mode = 'brand', gid = 'g') {
const CX = 131.5, f = (n) => Math.round(n * 100) / 100, q = (pt) => `${f(pt[0])},${f(pt[1])}`;
const w = P.w, r = w / 2;
const ln = Math.hypot(P.s, 1), legDir = [-P.s / ln, 1 / ln];
const lm = Math.hypot(P.sl, 1), lamDir = [-P.sl / lm, 1 / lm];
const A = [CX, P.ay], P1 = [A[0] + legDir[0] * P.t1, A[1] + legDir[1] * P.t1];
const C1 = [P1[0] + legDir[0] * P.h1, P1[1] + legDir[1] * P.h1], C2 = [P.vx, P.vy - P.h1];
const P2 = [P.vx, P.vy], P3 = [P.vx, P.vy2];
const L = [CX, P.ly], T = [L[0] + lamDir[0] * P.tt, L[1] + lamDir[1] * P.tt];
const yb = P.cy + P.ch / 2;          // crossbar underside
const yh = P.yh ?? 243;              // hole bottom (measured)
const rc = P.rc ?? 9;                // hole bottom-left corner radius
// Λ left edge (facing hole): offset centerline by r along n
const n = [-lamDir[1], lamDir[0]];
const edgeAt = (y) => { const o = [L[0] + n[0] * r, L[1] + n[1] * r]; const t = (y - o[1]) / lamDir[1]; return [o[0] + lamDir[0] * t, y]; };
// hook outer edge: from (vx - r, vy2) down, cubic to tangent point on cap circle
const xo = P.vx - r, xi = P.vx + r;
const ang = (P.capAng ?? 118) * Math.PI / 180;
const Eo = [T[0] + r * Math.cos(ang), T[1] + r * Math.sin(ang)];
const tdir = [Math.sin(ang), -Math.cos(ang)]; // tangent pointing toward bottom (down-right)
const ho = P.ho ?? 22, hi = P.hk ?? 30;
const hook = `M${q([xo, P.vy2])} C${q([xo, P.vy2 + ho])} ${q([Eo[0] - tdir[0] * hi, Eo[1] - tdir[1] * hi])} ${q(Eo)} L${q(T)} L${q(edgeAt(yh))} L${q([xi + rc, yh])} A${rc},${rc} 0 0 1 ${q([xi, yh - rc])} L${q([xi, P.vy2])} Z`;
// neck: stem joining crossbar underside to Λ apex, concave sides (measured: half-width ~33 at underside, meets Λ edge ~y192)
const nh = P.nh ?? 33, ye = P.ye ?? 192, nk1 = P.nk1 ?? 12, nk2 = P.nk2 ?? 10;
const E = edgeAt(ye); const S0 = [CX - nh, yb];
const fillet = `M${q(S0)} C${q([S0[0] + 1, S0[1] + nk1])} ${q([E[0] - lamDir[0] * nk2, E[1] - lamDir[1] * nk2])} ${q(E)} L${f(CX)},${f(E[1])} L${f(CX)},${f(yb)} Z`;
const mir = (d) => `<g transform="translate(${2 * CX} 0) scale(-1 1)">${d}</g>`;
const outerA = `M${q(P3)} L${q(P2)} C${q(C2)} ${q(C1)} ${q(P1)} L${q(A)} L${q([2 * CX - P1[0], P1[1]])} C${q([2 * CX - C1[0], C1[1]])} ${q([2 * CX - C2[0], C2[1]])} ${q([2 * CX - P2[0], P2[1]])} L${q([2 * CX - P3[0], P3[1]])}`;
const lam = `M${q(T)} L${q(L)} L${q([2 * CX - T[0], T[1]])}`;
const yt = P.cy - P.ch / 2, nw = P.nw ?? 22, nd = P.nd ?? 14, nt = P.nt ?? 4;
const bar = `M${f(CX - P.cw)},${f(yt)} L${f(CX - nw)},${f(yt)} C${f(CX - nw * 0.5)},${f(yt)} ${f(CX - nw * 0.42)},${f(yt + nd)} ${f(CX)},${f(yt + nd)} L${f(CX + nw)},${f(yt)} L${f(CX + nw)},${f(yt)} L${f(CX + P.cw)},${f(yt)} L${f(CX + P.cw)},${f(yb)} L${f(CX - P.cw)},${f(yb)} Z`;
const mono = mode.startsWith('mono:') ? mode.slice(5) : mode === 'mask' ? '#fff' : null;
const stops = PALETTES[mode] || PALETTES.brand;
const paint = mono || `url(#${gid})`;
const shade = !mono && (mode === 'faithful' || P.shade); // measured in the Canva original: the right half of the crossbar reads as passing OVER the left half — a dark falloff from centre toward the left.
const sx = CX + 1, sy = yt, sdx = -0.54, sdy = 0.84, nx = -0.84, ny = -0.54;
const shadeDefs = shade ? `<linearGradient id="${gid}-sh" gradientUnits="userSpaceOnUse" x1="${f(sx)}" y1="${f(sy)}" x2="${f(sx + nx * 34)}" y2="${f(sy + ny * 34)}"><stop offset="0" stop-color="#000" stop-opacity="0.72"/><stop offset="0.35" stop-color="#000" stop-opacity="0.42"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient><mask id="${gid}-m" maskUnits="userSpaceOnUse" x="0" y="0" width="264" height="282">BODYMASK</mask>` : '';
const sh0 = [sx - sdx * 12, sy - sdy * 12], sh1 = [sx + sdx * 95, sy + sdy * 95];
const shadeBody = shade ? `<path d="M${f(sh0[0])},${f(sh0[1])} L${f(sh1[0])},${f(sh1[1])} L${f(sh1[0] + nx * 70)},${f(sh1[1] + ny * 70)} L${f(sh0[0] + nx * 70)},${f(sh0[1] + ny * 70)} Z" fill="url(#${gid}-sh)" mask="url(#${gid}-m)"/>` : '';
const defs0 = mono ? '' : `<linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="0" y1="${f(P.ay - r)}" x2="0" y2="${f(T[1] + r)}">${stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}</linearGradient>`;
const body = `<g fill="${paint}" stroke="${paint}" stroke-linejoin="miter" stroke-miterlimit="10">
<path d="${outerA}" fill="none" stroke-width="${f(w)}" stroke-linecap="butt"/>
<path d="${lam}" fill="none" stroke-width="${f(w)}" stroke-linecap="round" stroke-linejoin="round"/>
<path d="${bar}" stroke-width="0.7"/>
<path d="${hook}" stroke-width="0.7"/>${mir(`<path d="${hook}" stroke-width="0.7"/>`)}
<path d="${fillet}" stroke-width="0.7"/>${mir(`<path d="${fillet}" stroke-width="0.7"/>`)}
</g>${shadeBody}`;
const defs = defs0 + shadeDefs.replace('BODYMASK', body.replace(/url(#[^)]+)/g, '#fff').replace(shadeBody, ''));
  return { defs, body, w: 264, h: 282, top: P.ay - r, bottom: T[1] + r };
}
export function markSvg(P, mode) {
  const m = buildMark(P, mode);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${m.w} ${m.h}" width="${m.w}" height="${m.h}">${m.defs ? `<defs>${m.defs}</defs>` : ''}${mode === 'mask' ? '<rect width="264" height="282" fill="#000"/>' : ''}${m.body}</svg>`;
}
if (process.argv[1] && /build-mark.mjs$/.test(process.argv[1]) && process.argv.length > 3) {
  const [fitJson, out, mode = 'brand'] = process.argv.slice(2);
  const P = JSON.parse(fs.readFileSync(fitJson, 'utf8')).P;
  fs.writeFileSync(out, markSvg(P, mode)); console.log('wrote', out);
}
