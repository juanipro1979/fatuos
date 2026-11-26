import { native } from "../lib/native";
import type { ToolDef, UiBridge, ChartSpec } from "./types";

export type ImageGenerator = ((prompt: string) => Promise<string>) | null;

export type ToolContext = { ui: UiBridge; generateImage: ImageGenerator };

type Impl = (args: any, ctx: ToolContext) => Promise<unknown>;

const RANGES: Record<string, { range: string; interval: string }> = {
  "1d": { range: "1d", interval: "5m" },
  "5d": { range: "5d", interval: "30m" },
  "1mo": { range: "1mo", interval: "1d" },
  "6mo": { range: "6mo", interval: "1d" },
  "1y": { range: "1y", interval: "1wk" },
  "5y": { range: "5y", interval: "1mo" },
};

// ───────── Bolsa (Yahoo Finance, sin key) ─────────
async function resolveSymbol(query: string): Promise<{ symbol: string; name: string }> {
  const q = query.trim();
  if (/^[A-Z0-9.^=-]{1,10}$/.test(q)) return { symbol: q, name: q };
  const json = JSON.parse(
    await native.webGet(
      `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=5&newsCount=0`,
    ),
  );
  const hit = (json.quotes ?? []).find((x: any) => x.symbol && x.quoteType !== "OPTION");
  if (!hit) throw new Error(`No encontré una acción para "${query}"`);
  return { symbol: hit.symbol, name: hit.shortname || hit.longname || hit.symbol };
}

async function stockChart(query: string, rangeKey = "1mo") {
  const { symbol, name } = await resolveSymbol(query);
  const r = RANGES[rangeKey] ?? RANGES["1mo"];
  const json = JSON.parse(
    await native.webGet(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${r.range}&interval=${r.interval}`,
    ),
  );
  const res = json.chart?.result?.[0];
  if (!res) throw new Error(json.chart?.error?.description ?? "Sin datos");
  const meta = res.meta;
  const ts: number[] = res.timestamp ?? [];
  const closes: (number | null)[] = res.indicators?.quote?.[0]?.close ?? [];
  const intraday = r.interval.endsWith("m");
  const points = ts
    .map((t, i) => ({
      label: new Date(t * 1000).toLocaleString("es-AR", intraday
        ? { hour: "2-digit", minute: "2-digit" }
        : { day: "2-digit", month: "short" }),
      value: closes[i] ?? NaN,
    }))
    .filter((p) => Number.isFinite(p.value));
  const price = meta.regularMarketPrice ?? points.at(-1)?.value;
  const prev = meta.chartPreviousClose ?? meta.previousClose ?? points[0]?.value;
  const change = prev ? ((price - prev) / prev) * 100 : 0;
  const currency = meta.currency ?? "USD";
  const spec: ChartSpec = {
    title: `${meta.longName ?? meta.shortName ?? name} (${symbol})`,
    subtitle: `${rangeKey} · ${meta.fullExchangeName ?? meta.exchangeName ?? ""}`,
    unit: currency,
    points,
    highlight: { value: `${price?.toFixed(2)} ${currency}`, change },
  };
  return { spec, summary: { symbol, name: spec.title, price, currency, changePct: +change.toFixed(2), range: rangeKey } };
}

// ───────── Imágenes (Openverse + Wikimedia, sin key) ─────────
type FoundImage = { url: string; title: string; credit: string; sourceUrl: string };

async function searchImages(query: string): Promise<FoundImage[]> {
  const found: FoundImage[] = [];
  try {
    const json = JSON.parse(
      await native.webGet(
        `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&page_size=8&mature=false`,
      ),
    );
    for (const r of json.results ?? []) {
      found.push({
        url: r.url,
        title: r.title ?? query,
        credit: [r.creator, r.license ? `CC ${String(r.license).toUpperCase()}` : ""].filter(Boolean).join(" · "),
        sourceUrl: r.foreign_landing_url ?? r.url,
      });
    }
  } catch {
    /* probamos Wikimedia */
  }
  if (found.length < 3) {
    const json = JSON.parse(
      await native.webGet(
        `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=8&gsrsearch=${encodeURIComponent(
          `${query} filetype:bitmap`,
        )}&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=1200`,
      ),
    );
    for (const p of Object.values<any>(json.query?.pages ?? {})) {
      const info = p.imageinfo?.[0];
      if (!info) continue;
      found.push({
        url: info.thumburl ?? info.url,
        title: String(p.title).replace(/^File:/, "").replace(/\.\w+$/, ""),
        credit: "Wikimedia Commons",
        sourceUrl: info.descriptionurl ?? info.url,
      });
    }
  }
  if (!found.length) throw new Error(`No encontré imágenes de "${query}"`);
  return found;
}

const slug = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "imagen";

// ───────── Web ─────────
function htmlToText(html: string) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script,style,noscript,svg,nav,footer,header,iframe").forEach((n) => n.remove());
  const title = doc.title;
  const text = (doc.body?.innerText || doc.body?.textContent || "").replace(/\n{3,}/g, "\n\n").replace(/[ \t]+/g, " ");
  return { title, text: text.trim() };
}

async function webSearch(query: string) {
  const html = await native.webGet(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`);
  const doc = new DOMParser().parseFromString(html, "text/html");
  const results = [...doc.querySelectorAll(".result")].slice(0, 6).map((r) => {
    const a = r.querySelector<HTMLAnchorElement>("a.result__a");
    let href = a?.getAttribute("href") ?? "";
    const m = /uddg=([^&]+)/.exec(href);
    if (m) href = decodeURIComponent(m[1]);
    return {
      title: a?.textContent?.trim() ?? "",
      url: href,
      snippet: r.querySelector(".result__snippet")?.textContent?.trim() ?? "",
    };
  });
  return results.filter((r) => r.url);
}

// ───────── Definiciones ─────────
const str = (description: string) => ({ type: "string", description });

export const TOOL_DEFS: ToolDef[] = [
  {
    name: "show_stock",
    description:
      "Muestra en pantalla un gráfico con el precio actual e histórico de una acción, índice, ETF o cripto (ej. NVDA, 'nvidia', BTC-USD). Devuelve precio y variación.",
    parameters: {
      type: "object",
      properties: {
        query: str("Ticker o nombre de la empresa"),
        range: { type: "string", enum: Object.keys(RANGES), description: "Período del gráfico (por defecto 1mo)" },
      },
      required: ["query"],
    },
  },
  {
    name: "show_chart",
    description: "Dibuja en pantalla un gráfico de línea con los datos que le pases (para cualquier dato numérico que no sea una acción).",
    parameters: {
      type: "object",
      properties: {
        title: str("Título"),
        unit: str("Unidad, ej. °C, USD, %"),
        points: {
          type: "array",
          description: "Puntos en orden",
          items: {
            type: "object",
            properties: { label: { type: "string" }, value: { type: "number" } },
            required: ["label", "value"],
          },
        },
      },
      required: ["title", "points"],
    },
  },
  {
    name: "show_image",
    description: "Busca una imagen en internet y la MUESTRA en pantalla sin guardarla. Usalo para 'mostrame un/una …'.",
    parameters: {
      type: "object",
      properties: { query: str("Qué buscar, idealmente en inglés (ej. 'pig')"), url: str("URL directa de una imagen (opcional)") },
      required: [],
    },
  },
  {
    name: "download_image",
    description:
      "Busca una imagen en internet y la DESCARGA en la carpeta Escritorio/Fatuos/downloads. Usalo para 'descargame/bajame una imagen de …'.",
    parameters: {
      type: "object",
      properties: {
        query: str("Qué buscar, idealmente en inglés (ej. 'cow')"),
        url: str("URL directa de una imagen (opcional)"),
        filename: str("Nombre del archivo sin extensión (opcional)"),
      },
      required: [],
    },
  },
  {
    name: "download_file",
    description: "Descarga cualquier archivo desde una URL a Escritorio/Fatuos/downloads.",
    parameters: {
      type: "object",
      properties: { url: str("URL http(s)"), filename: str("Nombre del archivo (opcional)") },
      required: ["url"],
    },
  },
  {
    name: "web_search",
    description: "Busca en la web y devuelve títulos, enlaces y fragmentos. Usalo para noticias, datos actuales o cualquier cosa que no sepas.",
    parameters: { type: "object", properties: { query: str("Búsqueda") }, required: ["query"] },
  },
  {
    name: "fetch_url",
    description: "Lee el texto de una página web.",
    parameters: { type: "object", properties: { url: str("URL http(s)") }, required: ["url"] },
  },
  {
    name: "open_downloads_folder",
    description: "Abre la carpeta Escritorio/Fatuos/downloads en el explorador de archivos.",
    parameters: { type: "object", properties: {}, required: [] },
  },
];

export const GENERATE_IMAGE_DEF: ToolDef = {
  name: "generate_image",
  description: "Genera una imagen nueva con IA a partir de una descripción. La muestra y, si save=true, la guarda en Escritorio/Fatuos/downloads.",
  parameters: {
    type: "object",
    properties: { prompt: str("Descripción detallada, en inglés"), save: { type: "boolean", description: "Guardarla en la carpeta" } },
    required: ["prompt"],
  },
};

const IMPLS: Record<string, Impl> = {
  async show_stock({ query, range }, { ui }) {
    ui.status(`mirando ${query}…`);
    const { spec, summary } = await stockChart(String(query), range);
    ui.showChart(spec);
    return summary;
  },
  async show_chart({ title, unit, points }, { ui }) {
    const pts = (points ?? []).map((p: any) => ({ label: String(p.label), value: Number(p.value) }));
    ui.showChart({ title, unit, points: pts });
    return { shown: true, points: pts.length };
  },
  async show_image({ query, url }, { ui }) {
    ui.status(`buscando ${query ?? "la imagen"}…`);
    const img = url ? { url, title: query ?? "", credit: "", sourceUrl: url } : (await searchImages(String(query)))[0];
    ui.showImage({ url: img.url, title: img.title, credit: img.credit, sourceUrl: img.sourceUrl });
    return { shown: img.title, credit: img.credit };
  },
  async download_image({ query, url, filename }, { ui }) {
    ui.status(`buscando ${query ?? "la imagen"}…`);
    const candidates = url ? [{ url, title: query ?? "imagen", credit: "", sourceUrl: url }] : await searchImages(String(query));
    let lastErr: unknown;
    for (const img of candidates.slice(0, 4)) {
      try {
        ui.status("descargando…");
        const path = await native.downloadUrl(img.url, filename || slug(query ?? img.title));
        ui.showImage({ ...img, savedPath: path });
        ui.notify("Guardado en Fatuos/downloads", path);
        return { saved: path, credit: img.credit };
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr ?? new Error("No pude descargar la imagen");
  },
  async download_file({ url, filename }, { ui }) {
    ui.status("descargando…");
    const path = await native.downloadUrl(String(url), filename);
    ui.notify("Guardado en Fatuos/downloads", path);
    return { saved: path };
  },
  async web_search({ query }, { ui }) {
    ui.status(`buscando "${query}"…`);
    return await webSearch(String(query));
  },
  async fetch_url({ url }, { ui }) {
    ui.status("leyendo la página…");
    const { title, text } = htmlToText(await native.webGet(String(url)));
    return { title, text: text.slice(0, 8000) };
  },
  async open_downloads_folder() {
    await native.openDownloads();
    return { opened: true };
  },
  async generate_image({ prompt, save }, { ui, generateImage }) {
    if (!generateImage) throw new Error("Este proveedor no genera imágenes. Usá OpenAI o Gemini.");
    ui.status("pintando…");
    const dataUrl = await generateImage(String(prompt));
    let savedPath: string | undefined;
    if (save) {
      savedPath = await native.saveBase64(dataUrl, slug(String(prompt)), dataUrl.slice(5, dataUrl.indexOf(";")));
      ui.notify("Guardado en Fatuos/downloads", savedPath);
    }
    ui.showImage({ url: dataUrl, title: String(prompt), credit: "Generada con IA", savedPath });
    return { shown: true, saved: savedPath ?? null };
  },
};

export async function runTool(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const impl = IMPLS[name];
  if (!impl) return JSON.stringify({ error: `herramienta desconocida: ${name}` });
  try {
    return JSON.stringify(await impl(args ?? {}, ctx));
  } catch (e) {
    return JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
  }
}
