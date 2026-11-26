import "../styles/sprite.css";
import type { CharacterId } from "../lib/settings";

export type Character = {
  id: CharacterId;
  name: string;
  tagline: string;
  core: string;
  edge: string;
  glow: string;
  greeting: string[];
};

export const CHARACTERS: Character[] = [
  {
    id: "chispa",
    name: "Chispa",
    tagline: "Rápida y curiosa. Vive buscando cosas en la web.",
    core: "#fff3c4",
    edge: "#ff9a3c",
    glow: "#ffb347",
    greeting: ["¿Qué buscamos?", "¡Pss! Acá estoy.", "Decime y lo encuentro."],
  },
  {
    id: "bruma",
    name: "Bruma",
    tagline: "Tranquila y observadora. Le encanta mirar tu pantalla.",
    core: "#efe9ff",
    edge: "#8f7cff",
    glow: "#a597ff",
    greeting: ["Mmm… ¿te ayudo?", "Alt+Espacio y miro tu pantalla.", "Hola, soy Bruma."],
  },
  {
    id: "tito",
    name: "Tito",
    tagline: "Ordenado. Baja archivos y los guarda en su carpeta.",
    core: "#e9ffe9",
    edge: "#3fcf8e",
    glow: "#5fe0a0",
    greeting: ["¿Te bajo algo?", "Tito al rescate.", "¿Qué necesitás?"],
  },
  {
    id: "lumi",
    name: "Lumi",
    tagline: "Artista. Dibuja gráficos y te muestra imágenes.",
    core: "#e8fbff",
    edge: "#38c8f0",
    glow: "#ff7ad9",
    greeting: ["¿Dibujamos algo?", "¡Holi!", "Te muestro lo que quieras."],
  },
];

export const characterById = (id: string) => CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0];

/** Silueta de llama con una punta distinta para cada personaje. */
function bodyPath(id: CharacterId) {
  switch (id) {
    case "chispa": // tres puntas
      return "M32 6 C35 14 38 12 40 8 C41 16 44 18 47 15 C47 24 54 32 54 44 C54 57 44 66 32 66 C20 66 10 57 10 44 C10 32 18 25 20 16 C23 20 26 20 28 14 C29 12 31 9 32 6 Z";
    case "bruma": // redondeada con cola de niebla
      return "M32 10 C42 12 52 24 53 40 C54 52 47 62 36 65 C30 67 22 69 16 66 C20 64 21 62 18 60 C12 55 10 48 11 40 C12 24 22 12 32 10 Z";
    case "tito": // gota limpia
      return "M32 8 C38 20 54 30 54 45 C54 57 44 66 32 66 C20 66 10 57 10 45 C10 30 26 20 32 8 Z";
    case "lumi": // punta en espiral
      return "M36 4 C30 8 30 14 36 16 C46 20 54 32 54 45 C54 57 44 66 32 66 C20 66 10 57 10 45 C10 30 22 20 28 12 C30 9 32 6 36 4 Z";
  }
}

export type Mood = "idle" | "thinking" | "happy" | "sleepy";

export function FatuoSprite({
  character,
  mood = "idle",
  size = 64,
  lookX = 0,
  lookY = 0,
}: {
  character: Character;
  mood?: Mood;
  size?: number;
  lookX?: number;
  lookY?: number;
}) {
  const id = character.id;
  const g = `g-${id}`;
  const ex = Math.max(-2.2, Math.min(2.2, lookX));
  const ey = Math.max(-2, Math.min(2, mood === "thinking" ? -2 : lookY));
  return (
    <svg
      className={`fatuo-svg mood-${mood}`}
      width={size}
      height={size * 1.125}
      viewBox="0 0 64 72"
      aria-label={character.name}
    >
      <defs>
        <radialGradient id={g} cx="50%" cy="62%" r="62%">
          <stop offset="0%" stopColor={character.core} />
          <stop offset="55%" stopColor={character.edge} stopOpacity="0.95" />
          <stop offset="100%" stopColor={character.edge} stopOpacity="0.55" />
        </radialGradient>
        <filter id={`${g}-glow`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3.2" />
        </filter>
      </defs>
      <path className="fatuo-halo" d={bodyPath(id)} fill={character.glow} filter={`url(#${g}-glow)`} opacity="0.75" />
      <g className="fatuo-flame">
        <path d={bodyPath(id)} fill={`url(#${g})`} />
        {id === "tito" && (
          <path d="M32 9 C30 4 26 3 23 4 C25 8 28 9 32 9 Z M32 9 C34 5 38 4 41 5 C39 9 35 10 32 9 Z" fill="#3fcf8e" />
        )}
        {id === "lumi" && (
          <path className="fatuo-star" d="M50 10 L51.5 14 L55.5 15 L51.5 16 L50 20 L48.5 16 L44.5 15 L48.5 14 Z" fill="#fff" />
        )}
        {id === "bruma" && (
          <g opacity="0.6" fill={character.core}>
            <circle cx="12" cy="64" r="2.2" />
            <circle cx="7" cy="60" r="1.4" />
          </g>
        )}
        {/* cara */}
        <g className="fatuo-face" transform={`translate(${ex} ${ey})`}>
          {mood === "happy" ? (
            <>
              <path d="M22.5 43 q3.5 -4 7 0" stroke="#2b2140" strokeWidth="2.4" fill="none" strokeLinecap="round" />
              <path d="M34.5 43 q3.5 -4 7 0" stroke="#2b2140" strokeWidth="2.4" fill="none" strokeLinecap="round" />
            </>
          ) : mood === "sleepy" ? (
            <>
              <path d="M22.5 43 h7" stroke="#2b2140" strokeWidth="2.4" strokeLinecap="round" />
              <path d="M34.5 43 h7" stroke="#2b2140" strokeWidth="2.4" strokeLinecap="round" />
            </>
          ) : (
            <g className="fatuo-eyes">
              <ellipse cx="26" cy="42" rx={id === "bruma" ? 4 : 3.4} ry={id === "bruma" ? 4.6 : 4.2} fill="#2b2140" />
              <ellipse cx="38" cy="42" rx={id === "bruma" ? 4 : 3.4} ry={id === "bruma" ? 4.6 : 4.2} fill="#2b2140" />
              <circle cx="27.3" cy="40.4" r="1.3" fill="#fff" />
              <circle cx="39.3" cy="40.4" r="1.3" fill="#fff" />
            </g>
          )}
          <ellipse cx="20" cy="49" rx="3" ry="1.8" fill={character.glow} opacity="0.55" />
          <ellipse cx="44" cy="49" rx="3" ry="1.8" fill={character.glow} opacity="0.55" />
          {mood === "thinking" ? (
            <circle cx="32" cy="51" r="1.8" fill="#2b2140" />
          ) : (
            <path d="M29 50 q3 3 6 0" stroke="#2b2140" strokeWidth="2" fill="none" strokeLinecap="round" />
          )}
        </g>
      </g>
      {mood === "thinking" && (
        <g className="fatuo-sparks" fill={character.core}>
          <circle cx="8" cy="20" r="2" />
          <circle cx="56" cy="22" r="1.6" />
          <circle cx="32" cy="2" r="1.4" />
        </g>
      )}
    </svg>
  );
}
