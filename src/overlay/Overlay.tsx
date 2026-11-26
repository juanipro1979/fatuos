import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { native, type Rect } from "../lib/native";
import { getSettings, onSettingsChanged, providerInfo, saveSettings, type Settings } from "../lib/settings";
import { runAgent } from "../agent/loop";
import type { Turn, UiBridge } from "../agent/types";
import { uid } from "../agent/types";
import { CHARACTERS, characterById, FatuoSprite, type Character, type Mood } from "./characters";
import { ChartView, ImageView, WidgetFrame, type Widget } from "./Widgets";
import { Capture } from "./Capture";
import "../styles/overlay.css";

type Active = {
  key: string;
  character: Character;
  mode: "wander" | "summoned";
  greeting?: string;
  leaving?: boolean;
};

type Toast = { id: string; text: string; path?: string };

const OFFSET = { x: 22, y: 16 };
const SPRITE = 58;
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

export function Overlay() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [paused, setPaused] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [active, setActive] = useState<Active | null>(null);
  const [pos, setPos] = useState({ x: -200, y: -200 });
  const [look, setLook] = useState({ x: 0, y: 0 });
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [reply, setReply] = useState("");
  const [error, setError] = useState("");
  const [widgets, setWidgets] = useState<Widget[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [capture, setCapture] = useState<string | null>(null);
  const [lastQuestion, setLastQuestion] = useState("");

  const cursor = useRef({ x: -200, y: -200 });
  const fpos = useRef({ x: -200, y: -200 });
  const activeRef = useRef<Active | null>(null);
  const history = useRef<Turn[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const leaveTimer = useRef<number>(0);
  activeRef.current = active;

  // ───── configuración ─────
  useEffect(() => {
    getSettings().then(setSettings);
    native.setInteractive(false); // por si un error anterior dejó la pantalla bloqueada
    const un = [onSettingsChanged(setSettings), listen<boolean>("paused", (e) => setPaused(e.payload))];
    return () => un.forEach((p) => p.then((f) => f()));
  }, []);

  const chooseCharacter = useCallback(
    () => (settings && settings.character !== "random" ? characterById(settings.character) : pick(CHARACTERS)),
    [settings],
  );

  // ───── aparecer / irse ─────
  const dismiss = useCallback(() => {
    const a = activeRef.current;
    if (!a) return;
    setActive({ ...a, leaving: true });
    window.clearTimeout(leaveTimer.current);
    leaveTimer.current = window.setTimeout(() => {
      setActive(null);
      setReply("");
      setError("");
      setStatus("");
      setInput("");
      history.current = [];
    }, 450);
    native.setInteractive(false);
  }, []);

  const summon = useCallback(
    (character?: Character, firstMessage?: { text: string; images?: string[] }) => {
      window.clearTimeout(leaveTimer.current);
      const a = activeRef.current;
      const c = character ?? a?.character ?? chooseCharacter();
      if (!a || a.mode !== "summoned" || a.leaving) {
        fpos.current = { x: cursor.current.x + OFFSET.x, y: cursor.current.y + OFFSET.y };
        setPos(fpos.current);
        history.current = [];
        setReply("");
        setError("");
      }
      setActive({ key: uid(), character: c, mode: "summoned", greeting: pick(c.greeting) });
      native.focusOverlay();
      setTimeout(() => inputRef.current?.focus(), 60);
      if (firstMessage) void send(firstMessage.text, firstMessage.images, c);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chooseCharacter],
  );

  const wander = useCallback(
    (greeting?: string) => {
      if (activeRef.current) return;
      const c = chooseCharacter();
      fpos.current = { x: cursor.current.x + OFFSET.x, y: cursor.current.y + OFFSET.y };
      setPos(fpos.current);
      setActive({ key: uid(), character: c, mode: "wander", greeting: greeting ?? pick(c.greeting) });
      window.clearTimeout(leaveTimer.current);
      leaveTimer.current = window.setTimeout(() => {
        if (activeRef.current?.mode === "wander") dismiss();
      }, greeting ? 14000 : 8500);
    },
    [chooseCharacter, dismiss],
  );

  // Aparición espontánea cada tanto
  useEffect(() => {
    if (!settings) return;
    let t = 0;
    const schedule = (first = false) => {
      const min = Math.max(0.5, settings.minMinutes);
      const max = Math.max(min, settings.maxMinutes);
      const ms = first ? 3500 : (min + Math.random() * (max - min)) * 60_000;
      t = window.setTimeout(() => {
        if (first && !settings.onboarded) {
          wander("¡Hola! Soy un fatuo. Clic en mí para pedirme algo, o Alt+D cuando quieras.");
          saveSettings({ ...settings, onboarded: true });
        } else if (settings.wander && !paused && !capture) wander();
        schedule();
      }, ms);
    };
    schedule(!settings.onboarded);
    return () => window.clearTimeout(t);
  }, [settings, paused, capture, wander]);

  // ───── eventos de Rust ─────
  useEffect(() => {
    const un = [
      listen<{ x: number; y: number }>("cursor", (e) => (cursor.current = e.payload)),
      listen("summon", () => summon()),
      listen("capture-prepare", () => setHidden(true)),
      listen<string>("capture-ready", (e) => {
        setHidden(false);
        setCapture(e.payload);
      }),
      listen<string>("capture-error", (e) => {
        setHidden(false);
        native.setInteractive(false);
        pushToast(`No pude capturar la pantalla: ${e.payload}`);
      }),
    ];
    return () => un.forEach((p) => p.then((f) => f()));
  }, [summon]);

  // ───── animación: seguir al cursor ─────
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const a = activeRef.current;
      const c = cursor.current;
      if (a && a.mode === "wander" && !a.leaving) {
        const tx = c.x + OFFSET.x;
        const ty = c.y + OFFSET.y;
        const dist = Math.hypot(c.x - (fpos.current.x + SPRITE / 2), c.y - (fpos.current.y + SPRITE / 2));
        // Si te acercás, se queda quieto para que lo puedas tocar.
        if (dist > 75) {
          fpos.current = { x: fpos.current.x + (tx - fpos.current.x) * 0.09, y: fpos.current.y + (ty - fpos.current.y) * 0.09 };
          setPos({ ...fpos.current });
        }
      }
      if (a) {
        const dx = c.x - (fpos.current.x + SPRITE / 2);
        const dy = c.y - (fpos.current.y + SPRITE / 2);
        const d = Math.hypot(dx, dy) || 1;
        setLook({ x: (dx / d) * 2, y: (dy / d) * 2 });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ───── zonas clicables → Rust ─────
  useEffect(() => {
    let last = "";
    const id = window.setInterval(() => {
      const rects: Rect[] = [...document.querySelectorAll<HTMLElement>(".hit")].map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.left - 4, y: r.top - 4, w: r.width + 8, h: r.height + 8 };
      });
      const sig = JSON.stringify(rects.map((r) => [r.x | 0, r.y | 0, r.w | 0, r.h | 0]));
      if (sig !== last) {
        last = sig;
        native.setHitRegions(rects);
      }
    }, 80);
    return () => window.clearInterval(id);
  }, []);

  // Esc para despedir
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !capture) dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dismiss, capture]);

  // ───── puente hacia las herramientas ─────
  function pushToast(text: string, path?: string) {
    const id = uid();
    setToasts((t) => [...t, { id, text, path }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 7000);
  }

  function placeWidget(): { x: number; y: number } {
    const base = fpos.current;
    const n = widgetsRef.current.length;
    let x = base.x + SPRITE + 20 + 330;
    if (x + 370 > window.innerWidth) x = Math.max(12, base.x - 390);
    let y = base.y - 40 + n * 28;
    y = Math.min(Math.max(12, y), window.innerHeight - 320);
    return { x: Math.min(x, window.innerWidth - 380), y };
  }
  const widgetsRef = useRef<Widget[]>([]);
  widgetsRef.current = widgets;

  const ui: UiBridge = {
    status: setStatus,
    showChart: (spec) => setWidgets((w) => [...w, { id: uid(), kind: "chart", spec, ...placeWidget() }]),
    showImage: (spec) => setWidgets((w) => [...w, { id: uid(), kind: "image", spec, ...placeWidget() }]),
    notify: pushToast,
  };

  async function send(text: string, images?: string[], character?: Character) {
    const s = settings ?? (await getSettings());
    const c = character ?? activeRef.current?.character ?? CHARACTERS[0];
    if (!text.trim()) return;
    setLastQuestion(text);
    setInput("");
    setReply("");
    setError("");
    setBusy(true);
    history.current.push({ role: "user", text, images });
    try {
      const answer = await runAgent(s, c.name, history.current, ui);
      setReply(answer || "¡Listo!");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      history.current.pop();
    } finally {
      setBusy(false);
      setStatus("");
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }

  // ───── render ─────
  const a = active;
  const mood: Mood = busy ? "thinking" : reply ? "happy" : a?.mode === "wander" ? "idle" : "idle";
  const bubbleLeft = pos.x + SPRITE + 14 + 320 > window.innerWidth;
  const provider = settings ? providerInfo(settings.provider) : null;

  return (
    <div className={`overlay ${hidden ? "is-hidden" : ""}`}>
      {capture && (
        <Capture
          image={capture}
          onCancel={() => {
            setCapture(null);
            native.setInteractive(false);
          }}
          onSend={(composite, question) => {
            setCapture(null);
            native.setInteractive(false);
            summon(characterById("bruma"), { text: question, images: [composite] });
          }}
        />
      )}

      {widgets.map((w) => {
        const accent = a?.character.edge ?? "#ffb347";
        const close = () => setWidgets((ws) => ws.filter((x) => x.id !== w.id));
        const move = (dx: number, dy: number) =>
          setWidgets((ws) => ws.map((x) => (x.id === w.id ? { ...x, x: x.x + dx, y: x.y + dy } : x)));
        return (
          <WidgetFrame key={w.id} w={w} onClose={close} onMove={move} accent={accent} title={w.kind === "chart" ? w.spec.title : w.spec.title || "Imagen"}>
            {w.kind === "chart" ? (
              <ChartView spec={w.spec} accent={accent} />
            ) : (
              <ImageView
                spec={w.spec}
                onSaved={(path) => {
                  setWidgets((ws) => ws.map((x) => (x.id === w.id && x.kind === "image" ? { ...x, spec: { ...x.spec, savedPath: path } } : x)));
                  pushToast("Guardado en Fatuos/downloads", path);
                }}
              />
            )}
          </WidgetFrame>
        );
      })}

      {a && (
        <div
          key={a.key}
          className={`fatuo ${a.leaving ? "leaving" : "arriving"} mode-${a.mode}`}
          style={{ left: pos.x, top: pos.y, ["--glow" as string]: a.character.glow }}
        >
          <button
            className="fatuo-hit hit"
            onClick={() => (a.mode === "wander" ? summon(a.character) : inputRef.current?.focus())}
            onContextMenu={(e) => {
              e.preventDefault();
              native.showMenu();
            }}
            aria-label={`Hablar con ${a.character.name}`}
          >
            <FatuoSprite character={a.character} mood={mood} size={SPRITE} lookX={look.x} lookY={look.y} />
          </button>

          {a.mode === "wander" && a.greeting && !a.leaving && (
            <div className={`speech hit ${bubbleLeft ? "left" : ""}`} onClick={() => summon(a.character)}>
              {a.greeting}
            </div>
          )}

          {a.mode === "summoned" && (
            <div className={`bubble hit pop-in ${bubbleLeft ? "left" : ""}`} style={{ ["--accent" as string]: a.character.edge }}>
              <div className="bubble-head">
                <span className="bubble-name">{a.character.name}</span>
                <span className="bubble-provider" title="Cambiar en el menú">
                  {provider?.name}
                </span>
                <button className="icon-btn" onClick={dismiss} aria-label="Cerrar">
                  ×
                </button>
              </div>

              {!busy && !reply && !error && <div className="bubble-text muted">{a.greeting}</div>}
              {busy && (
                <div className="bubble-text thinking">
                  <span className="dots"><i /><i /><i /></span> {status || "pensando…"}
                </div>
              )}
              {reply && !busy && (
                <div className="bubble-text">
                  {lastQuestion && <div className="q">“{lastQuestion}”</div>}
                  <Linkified text={reply} />
                </div>
              )}
              {error && !busy && (
                <div className="bubble-text error">
                  {error}
                  {/menú|API key|modelo|URL/i.test(error) && (
                    <button className="chip" onClick={() => native.showMenu()}>
                      Abrir menú
                    </button>
                  )}
                </div>
              )}

              <form
                className="bubble-input"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!busy) send(input);
                }}
              >
                <input
                  ref={inputRef}
                  value={input}
                  disabled={busy}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Pedime lo que quieras…"
                />
                <button type="submit" className="send" disabled={busy || !input.trim()} aria-label="Enviar">
                  ➤
                </button>
              </form>
              <div className="bubble-foot">Alt+Espacio mira tu pantalla · Esc cierra</div>
            </div>
          )}
        </div>
      )}

      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className="toast hit pop-in">
            <span>{t.text}</span>
            {t.path && (
              <button className="chip" onClick={() => native.revealFile(t.path!)}>
                Mostrar
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Linkified({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s)]+)/g);
  return (
    <span className="reply">
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a key={i} href="#" onClick={(e) => (e.preventDefault(), openUrl(p))}>
            {p.replace(/^https?:\/\/(www\.)?/, "").slice(0, 40)}
          </a>
        ) : (
          <span key={i}>{p.replace(/\*\*(.+?)\*\*/g, "$1")}</span>
        ),
      )}
    </span>
  );
}
