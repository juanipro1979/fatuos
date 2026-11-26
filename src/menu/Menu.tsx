import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { native } from "../lib/native";
import {
  PROVIDERS,
  baseUrlFor,
  getSettings,
  modelFor,
  providerInfo,
  saveSettings,
  type ProviderId,
  type Settings,
} from "../lib/settings";
import { CHARACTERS, FatuoSprite } from "../overlay/characters";
import { OpenAICompatible } from "../agent/providers/openai";
import { AnthropicProvider } from "../agent/providers/anthropic";
import { GeminiProvider } from "../agent/providers/gemini";
import { buildProvider } from "../agent/loop";
import "../styles/menu.css";

type Tab = "fatuos" | "modelo" | "atajos" | "carpeta" | "creditos";

const TABS: { id: Tab; label: string }[] = [
  { id: "fatuos", label: "Fatuos" },
  { id: "modelo", label: "Modelo" },
  { id: "atajos", label: "Atajos" },
  { id: "carpeta", label: "Carpeta" },
  { id: "creditos", label: "Créditos" },
];

export const REPO_URL = "https://github.com/juanipro1979/fatuos";

export function Menu() {
  const [tab, setTab] = useState<Tab>("fatuos");
  const [s, setS] = useState<Settings | null>(null);

  useEffect(() => {
    getSettings().then(setS);
  }, []);

  const update = (patch: Partial<Settings>) => {
    if (!s) return;
    const next = { ...s, ...patch };
    setS(next);
    saveSettings(next);
  };

  if (!s) return null;
  return (
    <div className="menu">
      <aside className="side">
        <div className="brand">
          <FatuoSprite character={CHARACTERS[0]} size={34} mood="happy" />
          <div>
            <div className="brand-name">Fatuos</div>
            <div className="brand-sub">lucecitas que ayudan</div>
          </div>
        </div>
        <nav>
          {TABS.map((t) => (
            <button key={t.id} className={`nav ${tab === t.id ? "on" : ""}`} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="side-foot">
          <span className={`dot ${providerInfo(s.provider).local ? "local" : ""}`} />
          {providerInfo(s.provider).name}
        </div>
      </aside>
      <main className="panel">
        {tab === "fatuos" && <FatuosTab s={s} update={update} />}
        {tab === "modelo" && <ModeloTab s={s} update={update} />}
        {tab === "atajos" && <AtajosTab />}
        {tab === "carpeta" && <CarpetaTab />}
        {tab === "creditos" && <CreditosTab />}
      </main>
    </div>
  );
}

type TabProps = { s: Settings; update: (p: Partial<Settings>) => void };

function FatuosTab({ s, update }: TabProps) {
  return (
    <section>
      <h1>Tus fatuos</h1>
      <p className="lead">Aparecen junto al cursor cada tanto, te saludan y se desvanecen. Tocalos para pedirles algo.</p>
      <div className="cards">
        <button className={`card char ${s.character === "random" ? "on" : ""}`} onClick={() => update({ character: "random" })}>
          <div className="char-row">
            {CHARACTERS.map((c) => (
              <FatuoSprite key={c.id} character={c} size={26} />
            ))}
          </div>
          <div className="card-title">Cualquiera</div>
          <div className="card-text">Cada vez aparece uno distinto.</div>
        </button>
        {CHARACTERS.map((c) => (
          <button
            key={c.id}
            className={`card char ${s.character === c.id ? "on" : ""}`}
            style={{ ["--accent" as string]: c.edge }}
            onClick={() => update({ character: c.id })}
          >
            <FatuoSprite character={c} size={54} />
            <div className="card-title">{c.name}</div>
            <div className="card-text">{c.tagline}</div>
          </button>
        ))}
      </div>

      <h2>Comportamiento</h2>
      <label className="toggle">
        <input type="checkbox" checked={s.wander} onChange={(e) => update({ wander: e.target.checked })} />
        <span>Que aparezcan solos cada tanto</span>
      </label>
      <div className={`range ${s.wander ? "" : "disabled"}`}>
        <span>Cada</span>
        <input
          type="number"
          min={1}
          max={120}
          value={s.minMinutes}
          onChange={(e) => update({ minMinutes: Math.max(1, +e.target.value) })}
        />
        <span>a</span>
        <input
          type="number"
          min={1}
          max={240}
          value={s.maxMinutes}
          onChange={(e) => update({ maxMinutes: Math.max(s.minMinutes, +e.target.value) })}
        />
        <span>minutos</span>
      </div>
      <p className="hint">Podés pausarlos cuando quieras desde el ícono de la bandeja → Pausar fatuos.</p>
    </section>
  );
}

function ModeloTab({ s, update }: TabProps) {
  const info = providerInfo(s.provider);
  const [key, setKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [cli, setCli] = useState<boolean | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    setKey("");
    setModels([]);
    setMsg(null);
    native.secretGet(s.provider).then((k) => setHasKey(!!k));
    if (info.kind === "cli") native.cliAvailable(s.provider).then(setCli);
    else setCli(null);
  }, [s.provider, info.kind]);

  const saveKey = async () => {
    await native.secretSet(s.provider, key.trim());
    setHasKey(!!key.trim());
    setKey("");
    setMsg({ ok: true, text: key.trim() ? "Key guardada en el llavero del sistema." : "Key borrada." });
  };

  const loadModels = async () => {
    setMsg(null);
    try {
      const k = await native.secretGet(s.provider);
      const list =
        info.kind === "anthropic"
          ? await AnthropicProvider.listModels(k ?? "")
          : info.kind === "gemini"
            ? await GeminiProvider.listModels(k ?? "")
            : await OpenAICompatible.listModels(baseUrlFor(s), k);
      setModels(list);
      setMsg({ ok: true, text: `${list.length} modelos disponibles.` });
    } catch (e) {
      setMsg({ ok: false, text: `No pude listar modelos: ${e}` });
    }
  };

  const test = async () => {
    setTesting(true);
    setMsg(null);
    try {
      if (info.kind === "cli") {
        const out = await native.runCli(s.provider, "Respondé solo: listo");
        setMsg({ ok: true, text: `Responde: ${out.trim().slice(0, 80)}` });
      } else {
        const { provider } = await buildProvider(s);
        const r = await provider.step("Respondé en 3 palabras.", [{ role: "user", text: "¿Funcionás?" }], []);
        setMsg({ ok: true, text: `Responde: ${(r.text ?? "").trim().slice(0, 80)}` });
      }
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  };

  const setModel = (m: string) => update({ models: { ...s.models, [s.provider]: m } });
  const setBase = (u: string) => update({ baseUrls: { ...s.baseUrls, [s.provider]: u } });

  return (
    <section>
      <h1>Modelo</h1>
      <p className="lead">Elegí con qué piensan tus fatuos: un modelo local en tu compu o una API con tu propia key.</p>
      <div className="providers">
        {PROVIDERS.map((p) => (
          <button
            key={p.id}
            className={`provider ${s.provider === p.id ? "on" : ""}`}
            onClick={() => update({ provider: p.id as ProviderId })}
          >
            <span className="p-name">{p.name}</span>
            <span className={`tag ${p.local ? "local" : ""}`}>{p.kind === "cli" ? "CLI" : p.local ? "local" : "API"}</span>
          </button>
        ))}
      </div>

      <div className="form">
        {info.note && <p className="hint">{info.note}</p>}

        {info.kind !== "cli" && (
          <>
            {(info.id === "custom" || info.local) && (
              <label className="field">
                <span>URL base</span>
                <input
                  value={s.baseUrls[s.provider] ?? info.baseUrl ?? ""}
                  placeholder="https://mi-servidor/v1"
                  onChange={(e) => setBase(e.target.value)}
                />
              </label>
            )}

            <label className="field">
              <span>Modelo</span>
              <div className="row">
                <input
                  list="model-list"
                  value={modelFor(s)}
                  placeholder="nombre-del-modelo"
                  onChange={(e) => setModel(e.target.value)}
                />
                <button className="ghost" onClick={loadModels}>
                  Ver modelos
                </button>
              </div>
              <datalist id="model-list">
                {models.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </label>

            {(info.needsKey || info.id === "custom") && (
              <label className="field">
                <span>
                  API key {hasKey && <em className="saved">guardada ✓</em>}
                </span>
                <div className="row">
                  <input
                    type="password"
                    value={key}
                    placeholder={hasKey ? "•••••••• (escribí otra para reemplazarla)" : "pegá tu key acá"}
                    onChange={(e) => setKey(e.target.value)}
                  />
                  <button className="ghost" onClick={saveKey}>
                    {key ? "Guardar" : hasKey ? "Borrar" : "Guardar"}
                  </button>
                </div>
                {info.keyUrl && (
                  <a className="link" href="#" onClick={(e) => (e.preventDefault(), openUrl(info.keyUrl!))}>
                    Conseguir una key →
                  </a>
                )}
              </label>
            )}
          </>
        )}

        {info.kind === "cli" && (
          <p className={cli ? "ok" : "warn"}>
            {cli === null ? "Buscando…" : cli ? `Encontré el comando instalado.` : `No encontré el comando. Instalalo y reiniciá Fatuos.`}
          </p>
        )}

        <div className="row">
          <button className="primary" onClick={test} disabled={testing}>
            {testing ? "Probando…" : "Probar conexión"}
          </button>
        </div>
        {msg && <p className={msg.ok ? "ok" : "warn"}>{msg.text}</p>}
        <p className="hint">
          Las keys se guardan en el llavero de tu sistema (Credential Manager, Keychain o Secret Service), nunca en texto plano.
          Para generar imágenes con IA hace falta una key de OpenAI o Gemini; sin eso, los fatuos buscan imágenes en la web.
        </p>
      </div>
    </section>
  );
}

function Kbd({ k }: { k: string }) {
  return (
    <span className="keys">
      {k.split("+").map((x) => (
        <kbd key={x}>{x}</kbd>
      ))}
    </span>
  );
}

function AtajosTab() {
  const rows: [string, string][] = [
    ["Alt+D", "Llamar a un fatuo junto al cursor"],
    ["Alt+Espacio", "Congelar la pantalla, dibujar encima y preguntar sobre lo que marcaste"],
    ["Enter", "Enviar el mensaje"],
    ["Esc", "Despedir al fatuo o cancelar la captura"],
    ["Ctrl+Z", "Deshacer un trazo en la captura"],
  ];
  return (
    <section>
      <h1>Atajos</h1>
      <div className="table">
        {rows.map(([k, d]) => (
          <div className="tr" key={k}>
            <Kbd k={k} />
            <span>{d}</span>
          </div>
        ))}
      </div>
      <h2>Ejemplos para pedir</h2>
      <ul className="examples">
        <li>“¿Cómo están las acciones de NVIDIA?”</li>
        <li>“Descargame una imagen de una vaca”</li>
        <li>“Mostrame un chancho”</li>
        <li>“¿Qué dice esta página?” (con Alt+Espacio)</li>
        <li>“Bitcoin del último año”</li>
        <li>“Buscá el clima de mañana en Córdoba”</li>
      </ul>
    </section>
  );
}

function CarpetaTab() {
  const [path, setPath] = useState("");
  useEffect(() => {
    native.downloadsPath().then(setPath);
  }, []);
  return (
    <section>
      <h1>Carpeta</h1>
      <p className="lead">Todo lo que descargan los fatuos va acá. No pueden guardar en ningún otro lado.</p>
      <div className="pathbox">
        <code>{path}</code>
        <button className="primary" onClick={() => native.openDownloads()}>
          Abrir carpeta
        </button>
      </div>
    </section>
  );
}

function CreditosTab() {
  const [v, setV] = useState("");
  useEffect(() => {
    getVersion().then(setV);
  }, []);
  return (
    <section className="credits">
      <div className="credits-hero">
        {CHARACTERS.map((c, i) => (
          <div key={c.id} className="float" style={{ animationDelay: `${i * 0.3}s` }}>
            <FatuoSprite character={c} size={60} mood={i % 2 ? "happy" : "idle"} />
          </div>
        ))}
      </div>
      <h1>Fatuos {v && <span className="ver">v{v}</span>}</h1>
      <p className="lead">
        Como los fuegos fatuos de las leyendas: lucecitas que aparecen de la nada, te muestran el camino y se desvanecen.
      </p>
      <div className="table">
        <div className="tr"><b>Idea</b><span>juanipro1979</span></div>
        <div className="tr"><b>Diseño y código</b><span>hecho junto con Claude (Anthropic)</span></div>
        <div className="tr"><b>Personajes</b><span>Chispa, Bruma, Tito y Lumi — originales de Fatuos</span></div>
        <div className="tr"><b>Hecho con</b><span>Tauri, Rust, React y TypeScript</span></div>
        <div className="tr"><b>Datos</b><span>Yahoo Finance, Openverse, Wikimedia Commons, DuckDuckGo</span></div>
        <div className="tr"><b>Licencia</b><span>MIT</span></div>
      </div>
      <div className="row">
        <button className="ghost" onClick={() => openUrl(REPO_URL)}>
          Ver en GitHub
        </button>
      </div>
    </section>
  );
}
