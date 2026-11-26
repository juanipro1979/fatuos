// Uso: node scripts/render-svg.mjs entrada.svg salida.png [ancho]
import { Resvg } from "@resvg/resvg-js";
import { readFileSync, writeFileSync } from "node:fs";
const [, , input, output, width] = process.argv;
const svg = readFileSync(input, "utf8");
const png = new Resvg(svg, { fitTo: { mode: "width", value: Number(width ?? 1024) }, font: { loadSystemFonts: true } }).render().asPng();
writeFileSync(output, png);
console.log(`ok ${output}`);
