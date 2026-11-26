import Anthropic from "@anthropic-ai/sdk";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type { Provider, ToolDef, Turn, StepResult } from "../types";
import { dataUrlParts } from "../types";

// Modelos que aceptan los fallbacks del servidor ante un rechazo.
const FALLBACK_MODELS = new Set([
  "claude-fable-5-2",
  "claude-fable-5-1",
  "claude-opus-5-5",
  "claude-opus-5",
  "claude-sonnet-5-5",
]);

export class AnthropicProvider implements Provider {
  nativeTools = true;
  private client: Anthropic;

  constructor(
    apiKey: string,
    private model: string,
  ) {
    // La petición sale por el plugin HTTP de Tauri (Rust), no por el navegador.
    this.client = new Anthropic({
      apiKey,
      dangerouslyAllowBrowser: true,
      fetch: tauriFetch as unknown as typeof globalThis.fetch,
    });
  }

  private toMessages(history: Turn[]): Anthropic.Beta.BetaMessageParam[] {
    const out: Anthropic.Beta.BetaMessageParam[] = [];
    for (const t of history) {
      if (t.role === "user") {
        const content: Anthropic.Beta.BetaContentBlockParam[] = [];
        for (const img of t.images ?? []) {
          const { mime, data } = dataUrlParts(img);
          content.push({
            type: "image",
            source: { type: "base64", media_type: mime as "image/jpeg", data },
          });
        }
        content.push({ type: "text", text: t.text });
        out.push({ role: "user", content });
      } else if (t.role === "assistant") {
        // Se devuelve el contenido completo (incluye bloques de thinking) tal cual vino.
        if (t.raw) out.push({ role: "assistant", content: t.raw as Anthropic.Beta.BetaContentBlockParam[] });
        else out.push({ role: "assistant", content: t.text || "…" });
      } else {
        out.push({
          role: "user",
          content: t.results.map((r) => ({
            type: "tool_result" as const,
            tool_use_id: r.id,
            content: r.content,
          })),
        });
      }
    }
    return out;
  }

  async step(system: string, history: Turn[], tools: ToolDef[]): Promise<StepResult> {
    const params: Record<string, unknown> = {
      model: this.model,
      max_tokens: 16000,
      system,
      messages: this.toMessages(history),
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      })),
    };
    if (FALLBACK_MODELS.has(this.model)) {
      params.betas = ["server-side-fallback-2026-07-01"];
      params.fallbacks = "default";
    }
    let response: Anthropic.Beta.BetaMessage;
    try {
      response = (await this.client.beta.messages.create(
        params as unknown as Anthropic.Beta.MessageCreateParamsNonStreaming,
      )) as Anthropic.Beta.BetaMessage;
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError) throw new Error("La API key de Claude no es válida.");
      if (error instanceof Anthropic.RateLimitError) throw new Error("Claude está saturado, probá en un rato.");
      if (error instanceof Anthropic.APIError) throw new Error(`Claude: ${error.status} ${error.message}`);
      throw error;
    }

    if (response.stop_reason === "refusal") {
      return { text: "Uy, con eso no te puedo ayudar.", raw: response.content };
    }
    let text = "";
    const toolCalls = [];
    for (const block of response.content) {
      if (block.type === "text") text += block.text;
      else if (block.type === "tool_use")
        toolCalls.push({ id: block.id, name: block.name, args: block.input as Record<string, unknown> });
    }
    return { text: text || undefined, toolCalls, raw: response.content };
  }

  static async listModels(apiKey: string): Promise<string[]> {
    const client = new Anthropic({
      apiKey,
      dangerouslyAllowBrowser: true,
      fetch: tauriFetch as unknown as typeof globalThis.fetch,
    });
    const ids: string[] = [];
    for await (const m of client.models.list()) ids.push(m.id);
    return ids;
  }
}
