import { load, Store } from "@tauri-apps/plugin-store";
import { emit, listen } from "@tauri-apps/api/event";

export type ProviderId =
  | "anthropic"
  | "openai"
  | "gemini"
  | "nvidia"
  | "openrouter"
  | "groq"
  | "ollama"
  | "lmstudio"
  | "custom"
  | "claude-code"
  | "opencode";

export type ProviderKind = "anthropic" | "openai" | "gemini" | "cli";

export type ProviderInfo = {
  id: ProviderId;
  name: string;
  kind: ProviderKind;
  baseUrl?: string;
  defaultModel: string;
  needsKey: boolean;
  local?: boolean;
  keyUrl?: string;
  note?: string;
};

export const PROVIDERS: ProviderInfo[] = [
  { id: "anthropic", name: "Claude (Anthropic)", kind: "anthropic", defaultModel: "claude-opus-5-5", needsKey: true, keyUrl: "https://platform.claude.com/settings/keys" },
  { id: "openai", name: "OpenAI", kind: "openai", baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4.1-mini", needsKey: true, keyUrl: "https://platform.openai.com/api-keys" },
  { id: "gemini", name: "Google Gemini", kind: "gemini", defaultModel: "gemini-2.5-flash", needsKey: true, keyUrl: "https://aistudio.google.com/apikey" },
  { id: "nvidia", name: "NVIDIA NIM", kind: "openai", baseUrl: "https://integrate.api.nvidia.com/v1", defaultModel: "meta/llama-3.3-70b-instruct", needsKey: true, keyUrl: "https://build.nvidia.com" },
  { id: "openrouter", name: "OpenRouter", kind: "openai", baseUrl: "https://openrouter.ai/api/v1", defaultModel: "openrouter/auto", needsKey: true, keyUrl: "https://openrouter.ai/keys" },
  { id: "groq", name: "Groq", kind: "openai", baseUrl: "https://api.groq.com/openai/v1", defaultModel: "llama-3.3-70b-versatile", needsKey: true, keyUrl: "https://console.groq.com/keys" },
  { id: "ollama", name: "Ollama (local)", kind: "openai", baseUrl: "http://localhost:11434/v1", defaultModel: "llama3.2", needsKey: false, local: true, note: "Instalá Ollama y corré `ollama pull llama3.2`." },
  { id: "lmstudio", name: "LM Studio (local)", kind: "openai", baseUrl: "http://localhost:1234/v1", defaultModel: "", needsKey: false, local: true, note: "Abrí LM Studio → Developer → Start Server." },
  { id: "custom", name: "Proveedor personalizado", kind: "openai", baseUrl: "", defaultModel: "", needsKey: false, note: "Cualquier API compatible con OpenAI (/v1/chat/completions)." },
  { id: "claude-code", name: "Claude Code (CLI)", kind: "cli", defaultModel: "", needsKey: false, local: true, note: "Usa el comando `claude` instalado en tu compu." },
  { id: "opencode", name: "OpenCode (CLI)", kind: "cli", defaultModel: "", needsKey: false, local: true, note: "Usa el comando `opencode` instalado en tu compu." },
];

export const providerInfo = (id: ProviderId) => PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];

export type CharacterId = "chispa" | "bruma" | "tito" | "lumi";

export type Settings = {
  provider: ProviderId;
  models: Partial<Record<ProviderId, string>>;
  baseUrls: Partial<Record<ProviderId, string>>;
  wander: boolean;
  minMinutes: number;
  maxMinutes: number;
  character: CharacterId | "random";
  visionHint: boolean;
  onboarded: boolean;
};

export const DEFAULTS: Settings = {
  provider: "ollama",
  models: {},
  baseUrls: {},
  wander: true,
  minMinutes: 3,
  maxMinutes: 10,
  character: "random",
  visionHint: true,
  onboarded: false,
};

let storePromise: Promise<Store> | null = null;
const store = () => (storePromise ??= load("settings.json", { autoSave: true, defaults: {} }));

export async function getSettings(): Promise<Settings> {
  const s = await store();
  const saved = (await s.get<Partial<Settings>>("settings")) ?? {};
  return { ...DEFAULTS, ...saved, models: { ...saved.models }, baseUrls: { ...saved.baseUrls } };
}

export async function saveSettings(next: Settings) {
  const s = await store();
  await s.set("settings", next);
  await s.save();
  await emit("settings-changed", next);
}

export function onSettingsChanged(cb: (s: Settings) => void) {
  return listen<Settings>("settings-changed", (e) => cb(e.payload));
}

export function modelFor(s: Settings, id: ProviderId = s.provider) {
  return s.models[id] || providerInfo(id).defaultModel;
}

export function baseUrlFor(s: Settings, id: ProviderId = s.provider) {
  return (s.baseUrls[id] || providerInfo(id).baseUrl || "").replace(/\/+$/, "");
}
