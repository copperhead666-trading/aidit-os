import type { Persona } from '@/lib/schemas';

/**
 * A persona's G-Brain knowledge graph — the same constellation SHAPE as
 * the real /brain graph, built lightweight from the persona's own config: an
 * Obsidian-style core in the middle, the persona's departments (pillars) ringed
 * around it, and each department's agents fanning out. Pure, deterministic SVG,
 * tinted with the persona's accent. No physics, no client state.
 */

const W = 900;
const H = 760;
const CX = W / 2;
const CY = H / 2;
const R_PILLAR = 210; // department ring
const R_AGENT = 328; // agent ring

const trunc = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// deterministic pseudo-random in [0,1) from a string — for the core dot field
function rand(seed: string, i: number): number {
  let h = 2166136261 ^ i;
  for (let k = 0; k < seed.length; k++) {
    h ^= seed.charCodeAt(k);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

const rad = (deg: number) => (deg * Math.PI) / 180;
const pt = (cx: number, cy: number, r: number, deg: number) => ({
  x: cx + r * Math.cos(rad(deg)),
  y: cy + r * Math.sin(rad(deg)),
});

export function PersonaBrainGraph({ persona }: { persona: Persona }) {
  const accent = persona.accent;
  const pillars = persona.pillars;
  const n = pillars.length || 1;
  const gid = `pbg-${persona.id}`;

  // one angular slice per pillar, first pillar straight up
  const sliceDeg = 360 / n;
  const pillarNodes = pillars.map((p, i) => {
    const angle = -90 + i * sliceDeg;
    const c = pt(CX, CY, R_PILLAR, angle);
    // agents fan out within this pillar's slice
    const k = p.agents.length;
    const spread = Math.min(sliceDeg * 0.78, 62);
    const agents = p.agents.map((name, j) => {
      const a = k === 1 ? angle : angle - spread / 2 + (j * spread) / (k - 1);
      return { name, ...pt(CX, CY, R_AGENT, a) };
    });
    return { pillar: p, angle, ...c, agents };
  });

  // Obsidian-style core dot field (deterministic)
  const coreDots = Array.from({ length: 46 }, (_, i) => {
    const a = rand(persona.id, i * 2) * 360;
    const r = 8 + rand(persona.id, i * 2 + 1) * 34;
    return { ...pt(CX, CY, r, a), s: 1 + rand(persona.id, i * 7) * 2.2 };
  });

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      className="block h-full w-full"
      role="img"
      aria-label={`${persona.name} knowledge graph`}
    >
      <defs>
        <radialGradient id={`${gid}-glow`} cx="50%" cy="50%" r="42%">
          <stop offset="0%" stopColor={accent} stopOpacity="0.18" />
          <stop offset="100%" stopColor={accent} stopOpacity="0" />
        </radialGradient>
        <pattern id={`${gid}-grid`} width="48" height="48" patternUnits="userSpaceOnUse">
          <path d="M48 0H0V48" fill="none" stroke="var(--hairline)" strokeWidth="1" />
        </pattern>
        <radialGradient id={`${gid}-core`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={accent} stopOpacity="0.9" />
          <stop offset="100%" stopColor={accent} stopOpacity="0.35" />
        </radialGradient>
      </defs>

      <rect x="0" y="0" width={W} height={H} fill={`url(#${gid}-grid)`} opacity="0.5" />
      <rect x="0" y="0" width={W} height={H} fill={`url(#${gid}-glow)`} />

      {/* faint orbit rings for the two tiers */}
      <circle cx={CX} cy={CY} r={R_PILLAR} fill="none" stroke="var(--hairline)" strokeWidth="1" opacity="0.7" />
      <circle cx={CX} cy={CY} r={R_AGENT} fill="none" stroke="var(--hairline)" strokeWidth="1" strokeDasharray="2 6" opacity="0.6" />

      {/* pillar -> agent spokes (fainter) */}
      {pillarNodes.map((pn, i) =>
        pn.agents.map((ag, j) => (
          <line key={`ae-${i}-${j}`} x1={pn.x} y1={pn.y} x2={ag.x} y2={ag.y} stroke={accent} strokeWidth="1" opacity="0.28" />
        )),
      )}

      {/* core -> pillar spokes, each with a travelling info-neuron */}
      {pillarNodes.map((pn, i) => {
        const start = pt(CX, CY, 48, pn.angle);
        const d = `M${start.x} ${start.y} L${pn.x} ${pn.y}`;
        return (
          <g key={`pe-${i}`}>
            <line x1={start.x} y1={start.y} x2={pn.x} y2={pn.y} stroke={accent} strokeWidth="1.6" opacity="0.45" />
            <path
              d={d}
              fill="none"
              stroke={accent}
              strokeWidth="1.8"
              strokeLinecap="round"
              pathLength={1}
              className="kg-synapse"
              style={{ ['--kg-syn-delay' as string]: `${(i % 6) * -0.8}s` }}
            />
          </g>
        );
      })}

      {/* agent dots + labels */}
      {pillarNodes.map((pn, i) =>
        pn.agents.map((ag, j) => (
          <g key={`a-${i}-${j}`}>
            <circle cx={ag.x} cy={ag.y} r="5" fill="var(--surface)" stroke={accent} strokeWidth="1.4" />
            <text
              x={ag.x}
              y={ag.y + (ag.y < CY ? -9 : 15)}
              textAnchor="middle"
              fontFamily="var(--font-mono)"
              fontSize="9"
              fill="var(--muted)"
            >
              {trunc(ag.name, 16)}
            </text>
          </g>
        )),
      )}

      {/* pillar nodes + labels */}
      {pillarNodes.map((pn, i) => (
        <g key={`p-${i}`}>
          <circle cx={pn.x} cy={pn.y} r="21" fill="var(--surface)" stroke={accent} strokeWidth="2" />
          <circle cx={pn.x} cy={pn.y} r="6" fill={accent} />
          <text
            x={pn.x}
            y={pn.y + (pn.y < CY ? -30 : 40)}
            textAnchor="middle"
            fontFamily="var(--font-mono)"
            fontSize="11"
            fontWeight={700}
            fill="var(--text)"
          >
            {trunc(pn.pillar.name, 22)}
          </text>
        </g>
      ))}

      {/* the core: an Obsidian-style constellation disc = the persona's brain */}
      <g>
        {coreDots.map((d, i) => (
          <circle key={`cd-${i}`} cx={d.x} cy={d.y} r={d.s} fill={accent} opacity="0.5" />
        ))}
        <circle cx={CX} cy={CY} r="48" fill="none" stroke={accent} strokeWidth="1.4" opacity="0.7" />
        <circle cx={CX} cy={CY} r="14" fill={`url(#${gid}-core)`} stroke={accent} strokeWidth="1.6" />
        <text x={CX} y={CY + 72} textAnchor="middle" fontFamily="var(--font-mono)" fontSize="10.5" fontWeight={700} fill={accent}>
          {trunc(persona.name, 24)}
        </text>
        <text x={CX} y={CY + 88} textAnchor="middle" fontFamily="var(--font-mono)" fontSize="8.5" letterSpacing="0.14em" fill="var(--dim)">
          KNOWLEDGE CORE
        </text>
      </g>
    </svg>
  );
}
