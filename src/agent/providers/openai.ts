import { fetch } from "@tauri-apps/plugin-http";
import type { Provider, ToolDef, Turn, StepResult } from "../types";
import { uid } from "../types";

/** OpenAI y todo lo compatible: NVIDIA NIM, OpenRouter, Groq, Ollama, LM Studio, personalizado. */
export class OpenAICompatible implements Provider {
  nativeTools = true;
  constructor(
    private baseUrl: string,
    private model: string,
    private apiKey: string | null,
  ) {}

  private toMessages(system: string, history: Turn[]) {
    const out: unknown[] = [{ role: "system", content: system }];
    for (const t of history) {
      if (t.role === "user") {
        out.push(
          t.images?.length
            ? {
                role: "user",
                content: [
                  { type: "text", text: t.text },
                  ...t.images.map((url) => ({ type: "image_url", image_url: { url } })),
                ],
              }
            : { role: "user", content: t.text },
        );
      } else if (t.role === "assistant") {
        out.push({
          role: "assistant",
          content: t.text ?? "",
          ...(t.toolCalls?.length && this.nativeTools
            ? {
                tool_calls: t.toolCalls.map((c) => ({
                  id: c.id,
                  type: "function",
                  function: { name: c.name, arguments: JSON.stringify(c.args) },
                })),
              }
            : {}),
        });
      } else {
        for (const r of t.results) {
          out.push(
            this.nativeTools
              ? { role: "tool", tool_call_id: r.id, content: r.content }
              : { role: "user", content: `Resultado de ${r.name}: ${r.content}` },
          );
        }
      }
    }
    return out;
  }

  async step(system: string, history: Turn[], tools: ToolDef[]): Promise<StepResult> {
    if (!this.baseUrl) throw new Error("Falta la URL del proveedor. Configurala en el menú.");
    if (!this.model) throw new Error("Falta elegir un modelo en el menú.");
    const body: Record<string, unknown> = {
      model: this.model,
      messages: this.toMessages(system, history),
    };
    if (this.nativeTools && tools.length) {
      body.tools = tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
    }
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        "HTTP-Referer": "https://github.com/fatuos",
        "X-Title": "Fatuos",
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      // Muchos modelos locales no soportan tools: pasamos al protocolo de texto.
      if (this.nativeTools && /tool|function/i.test(text) && res.status < 500) {
        this.nativeTools = false;
        return this.step(system, history, tools);
      }
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    const json = JSON.parse(text);
    const msg = json.choices?.[0]?.message ?? {};
    const toolCalls = (msg.tool_calls ?? []).map((c: any) => ({
      id: c.id || uid(),
      name: c.function?.name,
      args: safeParse(c.function?.arguments),
    }));
    return { text: msg.content ?? undefined, toolCalls };
  }

  static async listModels(baseUrl: string, apiKey: string | null): Promise<string[]> {
    const res = await fetch(`${baseUrl}/models`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return (json.data ?? []).map((m: any) => m.id).sort();
  }
}

function safeParse(s: unknown): Record<string, unknown> {
  if (typeof s !== "string") return (s as Record<string, unknown>) ?? {};
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

/** Generación de imágenes con OpenAI. Devuelve un data URL. */
export async function openaiImage(apiKey: string, prompt: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: "gpt-image-1", prompt, size: "1024x1024", n: 1 }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message ?? `HTTP ${res.status}`);
  const b64 = json.data?.[0]?.b64_json;
  if (b64) return `data:image/png;base64,${b64}`;
  if (json.data?.[0]?.url) return json.data[0].url;
  throw new Error("OpenAI no devolvió imagen");
}
