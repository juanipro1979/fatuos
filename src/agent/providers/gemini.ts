import { fetch } from "@tauri-apps/plugin-http";
import type { Provider, ToolDef, Turn, StepResult } from "../types";
import { dataUrlParts, uid } from "../types";

const BASE = "https://generativelanguage.googleapis.com/v1beta";

export class GeminiProvider implements Provider {
  nativeTools = true;
  constructor(
    private apiKey: string,
    private model: string,
  ) {}

  private toContents(history: Turn[]) {
    const out: unknown[] = [];
    for (const t of history) {
      if (t.role === "user") {
        out.push({
          role: "user",
          parts: [
            ...(t.images ?? []).map((img) => {
              const { mime, data } = dataUrlParts(img);
              return { inlineData: { mimeType: mime, data } };
            }),
            { text: t.text },
          ],
        });
      } else if (t.role === "assistant") {
        // Las partes originales llevan thoughtSignature: se devuelven intactas.
        out.push({ role: "model", parts: (t.raw as unknown[]) ?? [{ text: t.text ?? "" }] });
      } else {
        out.push({
          role: "user",
          parts: t.results.map((r) => ({
            functionResponse: { name: r.name, response: { result: r.content } },
          })),
        });
      }
    }
    return out;
  }

  async step(system: string, history: Turn[], tools: ToolDef[]): Promise<StepResult> {
    const res = await fetch(`${BASE}/models/${encodeURIComponent(this.model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: this.toContents(history),
        tools: [
          {
            functionDeclarations: tools.map((t) => ({
              name: t.name,
              description: t.description,
              parameters: t.parameters,
            })),
          },
        ],
      }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(`Gemini: ${json.error?.message ?? res.status}`);
    const parts: any[] = json.candidates?.[0]?.content?.parts ?? [];
    const text = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join("");
    const toolCalls = parts
      .filter((p) => p.functionCall)
      .map((p) => ({ id: uid(), name: p.functionCall.name, args: p.functionCall.args ?? {} }));
    return { text: text || undefined, toolCalls, raw: parts.length ? parts : undefined };
  }

  static async listModels(apiKey: string): Promise<string[]> {
    const res = await fetch(`${BASE}/models?pageSize=200`, { headers: { "x-goog-api-key": apiKey } });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error?.message ?? `HTTP ${res.status}`);
    return (json.models ?? [])
      .filter((m: any) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
      .map((m: any) => String(m.name).replace(/^models\//, ""));
  }
}

/** Generación de imágenes con Gemini. Devuelve un data URL. */
export async function geminiImage(apiKey: string, prompt: string): Promise<string> {
  const res = await fetch(`${BASE}/models/gemini-2.5-flash-image:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }] }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message ?? `HTTP ${res.status}`);
  const parts: any[] = json.candidates?.[0]?.content?.parts ?? [];
  const img = parts.find((p) => p.inlineData);
  if (!img) throw new Error("Gemini no devolvió imagen");
  return `data:${img.inlineData.mimeType};base64,${img.inlineData.data}`;
}
