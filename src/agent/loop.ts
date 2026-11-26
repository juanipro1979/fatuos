import { native } from "../lib/native";
import { baseUrlFor, modelFor, providerInfo, type Settings } from "../lib/settings";
import { AnthropicProvider } from "./providers/anthropic";
import { GeminiProvider, geminiImage } from "./providers/gemini";
import { OpenAICompatible, openaiImage } from "./providers/openai";
import { GENERATE_IMAGE_DEF, TOOL_DEFS, runTool, type ImageGenerator } from "./tools";
import type { Provider, ToolCall, ToolDef, Turn, UiBridge } from "./types";
import { uid } from "./types";

const MAX_STEPS = 8;

export function systemPrompt(character: string) {
  const now = new Date().toLocaleString("es-AR", { dateStyle: "full", timeStyle: "short" });
  return `Sos ${character}, un "fatuo": una lucecita que vive junto al cursor del usuario en su escritorio y lo ayuda.
Ahora es ${now}.
Reglas:
- Respondé SIEMPRE en el idioma del usuario, breve y cálido (1–3 oraciones). Nada de markdown pesado: el texto va en un globito.
- Hacé las cosas con herramientas en vez de explicar cómo hacerlas.
- Precios de acciones, índices o cripto → show_stock (ya dibuja el gráfico).
- "Mostrame un/una X" → show_image. "Descargame/bajame una imagen de X" → download_image. Otros archivos → download_file.
- Si el usuario quiere una imagen inventada o que no existe, y tenés generate_image, usala.
- Datos actuales o que no sabés → web_search y, si hace falta, fetch_url.
- Todo lo que se descarga queda en Escritorio/Fatuos/downloads. No podés guardar en otro lado.
- Si te mandan una captura de pantalla, las marcas rojas/de color son lo que el usuario señaló: prestales atención.
- Después de usar herramientas, contá en una frase qué hiciste.`;
}

async function keyFor(id: string) {
  return (await native.secretGet(id)) ?? null;
}

export async function buildProvider(s: Settings): Promise<{ provider: Provider; generateImage: ImageGenerator }> {
  const info = providerInfo(s.provider);
  const model = modelFor(s);
  const key = await keyFor(s.provider);
  if (info.needsKey && !key) throw new Error(`Falta la API key de ${info.name}. Abrí el menú (clic derecho en el ícono → Mostrar menú).`);

  // Generación de imágenes: con la key de OpenAI o Gemini si existe alguna.
  const openaiKey = s.provider === "openai" ? key : await keyFor("openai");
  const geminiKey = s.provider === "gemini" ? key : await keyFor("gemini");
  const generateImage: ImageGenerator = openaiKey
    ? (p) => openaiImage(openaiKey, p)
    : geminiKey
      ? (p) => geminiImage(geminiKey, p)
      : null;

  switch (info.kind) {
    case "anthropic":
      return { provider: new AnthropicProvider(key!, model), generateImage };
    case "gemini":
      return { provider: new GeminiProvider(key!, model), generateImage };
    case "openai":
      return { provider: new OpenAICompatible(baseUrlFor(s), model, key), generateImage };
    case "cli":
      throw new Error("cli"); // se maneja aparte en runAgent
  }
}

// ───────── Protocolo de texto para modelos sin tools nativas ─────────
function textProtocolPrompt(tools: ToolDef[]) {
  return `\n\nPara usar una herramienta, respondé SOLO con una línea así:
<tool>{"name": "nombre", "args": {...}}</tool>
Después vas a recibir el resultado. Herramientas disponibles:
${tools.map((t) => `- ${t.name}: ${t.description} Parámetros: ${JSON.stringify(t.parameters.properties)}`).join("\n")}`;
}

function parseTextToolCalls(text: string): { clean: string; calls: ToolCall[] } {
  const calls: ToolCall[] = [];
  const clean = text
    .replace(/<tool>([\s\S]*?)<\/tool>/g, (_, body) => {
      try {
        const j = JSON.parse(body);
        if (j.name) calls.push({ id: uid(), name: j.name, args: j.args ?? {} });
      } catch {
        /* ignorar */
      }
      return "";
    })
    .trim();
  return { clean, calls };
}

// ───────── CLIs (Claude Code / OpenCode) ─────────
async function runCliAgent(s: Settings, character: string, history: Turn[], ui: UiBridge, generateImage: ImageGenerator) {
  const last = history.at(-1);
  let capturePath = "";
  if (last?.role === "user" && last.images?.length) capturePath = await native.saveCaptureForCli(last.images[0]);
  const transcript = history
    .filter((t) => t.role !== "tool")
    .map((t) => (t.role === "user" ? `Usuario: ${t.text}` : `Vos: ${(t as any).text ?? ""}`))
    .join("\n");
  const prompt = `${systemPrompt(character)}

Estás corriendo dentro de Fatuos. Además de tus herramientas propias (buscar en la web, leer archivos), podés pedirle a Fatuos que muestre cosas en pantalla agregando al FINAL de tu respuesta un bloque:
\`\`\`fatuo
[{"name": "show_stock", "args": {"query": "NVDA"}}]
\`\`\`
Acciones posibles: ${TOOL_DEFS.map((t) => t.name).join(", ")}${generateImage ? ", generate_image" : ""}. Usá los mismos argumentos que describiría una API (query, url, filename, range, title, points).
${capturePath ? `El usuario te mandó una captura de su pantalla con marcas: está en ${capturePath}. Leela.` : ""}

Conversación:
${transcript}

Respondé al último mensaje del usuario.`;
  ui.status("pensando…");
  const out = await native.runCli(s.provider, prompt);
  const actions: ToolCall[] = [];
  const clean = out
    .replace(/```fatuo\s*([\s\S]*?)```/g, (_, body) => {
      try {
        for (const a of JSON.parse(body)) actions.push({ id: uid(), name: a.name, args: a.args ?? {} });
      } catch {
        /* ignorar */
      }
      return "";
    })
    .trim();
  for (const a of actions) await runTool(a.name, a.args, { ui, generateImage });
  history.push({ role: "assistant", text: clean });
  return clean;
}

/** Corre el agente sobre el historial (que se modifica in place). Devuelve el texto final. */
export async function runAgent(s: Settings, character: string, history: Turn[], ui: UiBridge): Promise<string> {
  const info = providerInfo(s.provider);
  if (info.kind === "cli") {
    const openaiKey = await keyFor("openai");
    const geminiKey = await keyFor("gemini");
    const gen: ImageGenerator = openaiKey ? (p) => openaiImage(openaiKey, p) : geminiKey ? (p) => geminiImage(geminiKey, p) : null;
    return runCliAgent(s, character, history, ui, gen);
  }

  const { provider, generateImage } = await buildProvider(s);
  const tools = generateImage ? [...TOOL_DEFS, GENERATE_IMAGE_DEF] : TOOL_DEFS;
  const ctx = { ui, generateImage };
  const sys = systemPrompt(character);

  for (let step = 0; step < MAX_STEPS; step++) {
    ui.status(step === 0 ? "pensando…" : "un toque más…");
    const system = provider.nativeTools ? sys : sys + textProtocolPrompt(tools);
    const r = await provider.step(system, history, tools);
    let text = r.text ?? "";
    let calls = r.toolCalls ?? [];
    if (!provider.nativeTools || (!calls.length && text.includes("<tool>"))) {
      const parsed = parseTextToolCalls(text);
      text = parsed.clean;
      if (parsed.calls.length) calls = parsed.calls;
    }
    history.push({ role: "assistant", text, toolCalls: calls, raw: r.raw });
    if (!calls.length) return text;
    const results = await Promise.all(
      calls.map(async (c) => ({ id: c.id, name: c.name, content: await runTool(c.name, c.args, ctx) })),
    );
    history.push({ role: "tool", results });
  }
  return "Me enredé un poco. ¿Lo intentamos de otra forma?";
}
