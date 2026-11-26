export type JsonSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
};

export type ToolDef = {
  name: string;
  description: string;
  parameters: JsonSchema;
};

export type ToolCall = { id: string; name: string; args: Record<string, unknown> };

export type Turn =
  | { role: "user"; text: string; images?: string[] /* data URLs */ }
  | { role: "assistant"; text?: string; toolCalls?: ToolCall[]; raw?: unknown }
  | { role: "tool"; results: { id: string; name: string; content: string }[] };

export type StepResult = { text?: string; toolCalls?: ToolCall[]; raw?: unknown };

export interface Provider {
  /** Una vuelta del modelo: devuelve texto y/o llamadas a herramientas. */
  step(system: string, history: Turn[], tools: ToolDef[]): Promise<StepResult>;
  /** false → el bucle usa el protocolo de texto <tool>{…}</tool>. */
  nativeTools: boolean;
}

export type ChartSpec = {
  title: string;
  subtitle?: string;
  unit?: string;
  points: { label: string; value: number }[];
  highlight?: { value: string; change?: number };
};

export type ImageSpec = {
  url: string;
  title?: string;
  credit?: string;
  sourceUrl?: string;
  savedPath?: string;
};

export type UiBridge = {
  status: (text: string) => void;
  showChart: (spec: ChartSpec) => void;
  showImage: (spec: ImageSpec) => void;
  notify: (text: string, path?: string) => void;
};

export const dataUrlParts = (url: string) => {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(url);
  return m ? { mime: m[1], data: m[2] } : { mime: "image/jpeg", data: url };
};

export const uid = () => Math.random().toString(36).slice(2, 10);
