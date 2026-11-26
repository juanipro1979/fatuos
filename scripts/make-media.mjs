// Genera las imágenes del README: node scripts/make-media.mjs
import { Resvg } from "@resvg/resvg-js";
import { writeFileSync } from "node:fs";

const CH = {
  chispa: { name: "Chispa", core: "#fff3c4", edge: "#ff9a3c", glow: "#ffb347", body: "M32 6 C35 14 38 12 40 8 C41 16 44 18 47 15 C47 24 54 32 54 44 C54 57 44 66 32 66 C20 66 10 57 10 44 C10 32 18 25 20 16 C23 20 26 20 28 14 C29 12 31 9 32 6 Z" },
  bruma: { name: "Bruma", core: "#efe9ff", edge: "#8f7cff", glow: "#a597ff", body: "M32 10 C42 12 52 24 53 40 C54 52 47 62 36 65 C30 67 22 69 16 66 C20 64 21 62 18 60 C12 55 10 48 11 40 C12 24 22 12 32 10 Z" },
  tito: { name: "Tito", core: "#e9ffe9", edge: "#3fcf8e", glow: "#5fe0a0", body: "M32 8 C38 20 54 30 54 45 C54 57 44 66 32 66 C20 66 10 57 10 45 C10 30 26 20 32 8 Z" },
  lumi: { name: "Lumi", core: "#e8fbff", edge: "#38c8f0", glow: "#ff7ad9", body: "M36 4 C30 8 30 14 36 16 C46 20 54 32 54 45 C54 57 44 66 32 66 C20 66 10 57 10 45 C10 30 22 20 28 12 C30 9 32 6 36 4 Z" },
};

const FONT = `font-family="Segoe UI, Arial, sans-serif"`;

function sprite(id, x, y, scale, { happy = false } = {}) {
  const c = CH[id];
  const eyeR = id === "bruma" ? [4, 4.6] : [3.4, 4.2];
  const extras =
    id === "tito"
      ? `<path d="M32 9 C30 4 26 3 23 4 C25 8 28 9 32 9 Z M32 9 C34 5 38 4 41 5 C39 9 35 10 32 9 Z" fill="#3fcf8e"/>`
      : id === "lumi"
        ? `<path d="M50 10 L51.5 14 L55.5 15 L51.5 16 L50 20 L48.5 16 L44.5 15 L48.5 14 Z" fill="#fff"/>`
        : id === "bruma"
          ? `<g opacity="0.6" fill="${c.core}"><circle cx="12" cy="64" r="2.2"/><circle cx="7" cy="60" r="1.4"/></g>`
          : "";
  const eyes = happy
    ? `<path d="M22.5 43 q3.5 -4 7 0" stroke="#2b2140" stroke-width="2.4" fill="none" stroke-linecap="round"/><path d="M34.5 43 q3.5 -4 7 0" stroke="#2b2140" stroke-width="2.4" fill="none" stroke-linecap="round"/>`
    : `<ellipse cx="26" cy="42" rx="${eyeR[0]}" ry="${eyeR[1]}" fill="#2b2140"/><ellipse cx="38" cy="42" rx="${eyeR[0]}" ry="${eyeR[1]}" fill="#2b2140"/><circle cx="27.3" cy="40.4" r="1.3" fill="#fff"/><circle cx="39.3" cy="40.4" r="1.3" fill="#fff"/>`;
  return `<g transform="translate(${x} ${y}) scale(${scale})">
    <path d="${c.body}" fill="${c.glow}" filter="url(#blur)" opacity="0.8"/>
    <path d="${c.body}" fill="url(#g-${id})"/>
    ${extras}
    ${eyes}
    <ellipse cx="20" cy="49" rx="3" ry="1.8" fill="${c.glow}" opacity="0.55"/>
    <ellipse cx="44" cy="49" rx="3" ry="1.8" fill="${c.glow}" opacity="0.55"/>
    <path d="M29 50 q3 3 6 0" stroke="#2b2140" stroke-width="2" fill="none" stroke-linecap="round"/>
  </g>`;
}

const defs = `<defs>
  <filter id="blur" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="3.4"/></filter>
  <filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="14" stdDeviation="18" flood-color="#000" flood-opacity="0.45"/></filter>
  <radialGradient id="night" cx="70%" cy="0%" r="110%"><stop offset="0%" stop-color="#33255a"/><stop offset="55%" stop-color="#1a1428"/><stop offset="100%" stop-color="#110d1a"/></radialGradient>
  <linearGradient id="area" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#3fdc8f" stop-opacity="0.35"/><stop offset="100%" stop-color="#3fdc8f" stop-opacity="0"/></linearGradient>
  ${Object.entries(CH)
    .map(
      ([id, c]) => `<radialGradient id="g-${id}" cx="50%" cy="62%" r="62%"><stop offset="0%" stop-color="${c.core}"/><stop offset="55%" stop-color="${c.edge}" stop-opacity="0.95"/><stop offset="100%" stop-color="${c.edge}" stop-opacity="0.55"/></radialGradient>`,
    )
    .join("")}
</defs>`;

function stars(n, w, h, seed = 7) {
  let s = seed;
  const r = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  return Array.from({ length: n }, () => `<circle cx="${(r() * w).toFixed(0)}" cy="${(r() * h).toFixed(0)}" r="${(r() * 1.6 + 0.3).toFixed(1)}" fill="#fff" opacity="${(r() * 0.5 + 0.1).toFixed(2)}"/>`).join("");
}

function render(name, svg, width) {
  writeFileSync(`docs/media/${name}.svg`, svg);
  const png = new Resvg(svg, { fitTo: { mode: "width", value: width }, font: { loadSystemFonts: true } }).render().asPng();
  writeFileSync(`docs/media/${name}.png`, png);
  console.log("ok", name);
}

// ───── Banner ─────
render(
  "banner",
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 460">${defs}
  <rect width="1280" height="460" rx="28" fill="url(#night)"/>
  ${stars(90, 1280, 460)}
  ${sprite("bruma", 760, 190, 2.2)}
  ${sprite("chispa", 880, 70, 3.4, { happy: true })}
  ${sprite("tito", 1060, 210, 2.0)}
  ${sprite("lumi", 1140, 80, 1.8)}
  <text x="90" y="205" ${FONT} font-size="104" font-weight="800" fill="#f6f1ff" letter-spacing="-3">Fatuos</text>
  <text x="94" y="262" ${FONT} font-size="28" fill="#c9c0dc">Tiny AI agents that live next to your cursor.</text>
  <text x="94" y="300" ${FONT} font-size="22" fill="#8f86a6">Pequeños agentes de IA que viven junto a tu cursor.</text>
  <g ${FONT} font-size="17" fill="#f6f1ff">
    <rect x="94" y="336" width="104" height="36" rx="18" fill="#ffffff14"/><text x="146" y="360" text-anchor="middle">Windows</text>
    <rect x="208" y="336" width="90" height="36" rx="18" fill="#ffffff14"/><text x="253" y="360" text-anchor="middle">macOS</text>
    <rect x="308" y="336" width="80" height="36" rx="18" fill="#ffffff14"/><text x="348" y="360" text-anchor="middle">Linux</text>
    <rect x="398" y="336" width="170" height="36" rx="18" fill="#3fcf8e22"/><text x="483" y="360" text-anchor="middle" fill="#8ff0bf">local o tu API key</text>
  </g>
</svg>`,
  1280,
);

// ───── Personajes ─────
const ids = Object.keys(CH);
const taglines = {
  chispa: ["Rápida y curiosa.", "Busca en la web."],
  bruma: ["Tranquila y observadora.", "Mira tu pantalla."],
  tito: ["Ordenado.", "Baja y guarda archivos."],
  lumi: ["Artista.", "Gráficos e imágenes."],
};
render(
  "characters",
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 380">${defs}
  <rect width="1200" height="380" rx="28" fill="url(#night)"/>
  ${stars(50, 1200, 380, 3)}
  ${ids
    .map((id, i) => {
      const cx = 150 + i * 300;
      return `<rect x="${cx - 125}" y="30" width="250" height="320" rx="24" fill="#ffffff08" stroke="#ffffff14"/>
      ${sprite(id, cx - 64, 60, 2, { happy: i % 2 === 1 })}
      <text x="${cx}" y="260" ${FONT} font-size="30" font-weight="800" text-anchor="middle" fill="${CH[id].edge}">${CH[id].name}</text>
      <text x="${cx}" y="296" ${FONT} font-size="17" text-anchor="middle" fill="#c9c0dc">${taglines[id][0]}</text>
      <text x="${cx}" y="322" ${FONT} font-size="17" text-anchor="middle" fill="#8f86a6">${taglines[id][1]}</text>`;
    })
    .join("")}
</svg>`,
  1200,
);

// ───── Demo: "¿cómo están las acciones de NVIDIA?" (ilustración) ─────
const pts = [131.2, 133.8, 132.1, 135.4, 137.9, 136.2, 138.8, 141.5, 139.7, 140.2, 143.6, 142.1, 144.9, 146.3, 145.1, 147.8, 149.2, 148.1, 150.6, 152.3];
const min = Math.min(...pts), max = Math.max(...pts);
const X = (i) => 872 + (i / (pts.length - 1)) * 270;
const Y = (v) => 340 + (1 - (v - min) / (max - min)) * 120;
const line = pts.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
render(
  "demo-stocks",
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 620">${defs}
  <rect width="1200" height="620" rx="24" fill="#1f2a44"/>
  <rect width="1200" height="620" rx="24" fill="url(#night)" opacity="0.85"/>
  <!-- ventana de fondo -->
  <g opacity="0.55">
    <rect x="60" y="60" width="560" height="470" rx="14" fill="#262036"/>
    <rect x="60" y="60" width="560" height="38" rx="14" fill="#2f2843"/>
    <circle cx="86" cy="79" r="6" fill="#ff5f7e"/><circle cx="106" cy="79" r="6" fill="#ffd23f"/><circle cx="126" cy="79" r="6" fill="#3fdc8f"/>
    ${[140, 175, 210, 260, 295, 330, 380, 415].map((y, i) => `<rect x="96" y="${y}" width="${[420, 360, 400, 300, 440, 260, 380, 320][i]}" height="14" rx="7" fill="#ffffff18"/>`).join("")}
  </g>
  <!-- cursor -->
  <path d="M430 300 l0 34 l9 -9 l7 15 l6 -3 l-7 -14 l13 0 z" fill="#fff" stroke="#000" stroke-width="1.5"/>
  ${sprite("chispa", 452, 318, 1.05)}
  <!-- globito -->
  <g filter="url(#soft)">
    <rect x="530" y="300" width="300" height="150" rx="18" fill="#18132a" stroke="#ffffff1a"/>
    <rect x="530" y="300" width="300" height="3" rx="1.5" fill="#ff9a3c"/>
  </g>
  <text x="548" y="330" ${FONT} font-size="15" font-weight="700" fill="#ff9a3c">Chispa</text>
  <text x="604" y="330" ${FONT} font-size="12" fill="#8f86a6">Claude (Anthropic)</text>
  <text x="548" y="356" ${FONT} font-size="12.5" fill="#8f86a6">“¿Cómo están las acciones de NVIDIA?”</text>
  <text x="548" y="380" ${FONT} font-size="14" fill="#f6f1ff">NVIDIA cerró en 152,30 USD, +16% en el</text>
  <text x="548" y="400" ${FONT} font-size="14" fill="#f6f1ff">último mes. Te dejé el gráfico al lado.</text>
  <rect x="546" y="414" width="268" height="26" rx="9" fill="#ffffff0e" stroke="#ffffff14"/>
  <text x="558" y="432" ${FONT} font-size="12.5" fill="#8f86a6">Pedime lo que quieras…</text>
  <!-- widget del gráfico -->
  <g filter="url(#soft)"><rect x="850" y="210" width="314" height="290" rx="20" fill="#141020" stroke="#ffffff1a"/></g>
  <text x="872" y="242" ${FONT} font-size="15" font-weight="600" fill="#f6f1ff">NVIDIA Corporation (NVDA)</text>
  <text x="1142" y="242" ${FONT} font-size="18" text-anchor="end" fill="#8f86a6">×</text>
  <line x1="850" y1="256" x2="1164" y2="256" stroke="#ffffff14"/>
  <text x="872" y="292" ${FONT} font-size="28" font-weight="700" fill="#f6f1ff">152.30 USD</text>
  <text x="872" y="314" ${FONT} font-size="12.5" fill="#8f86a6">1mo · NasdaqGS</text>
  <text x="1142" y="292" ${FONT} font-size="16" font-weight="700" text-anchor="end" fill="#3fdc8f">▲ 16.08%</text>
  <path d="${line} L${X(pts.length - 1)},468 L${X(0)},468 Z" fill="url(#area)"/>
  <path d="${line}" fill="none" stroke="#3fdc8f" stroke-width="2.5" stroke-linejoin="round"/>
  <text x="872" y="488" ${FONT} font-size="11" fill="#8f86a6">27 oct</text>
  <text x="1142" y="488" ${FONT} font-size="11" text-anchor="end" fill="#8f86a6">25 nov</text>
  <text x="60" y="585" ${FONT} font-size="14" fill="#8f86a6">Ilustración: datos de ejemplo</text>
</svg>`,
  1200,
);
