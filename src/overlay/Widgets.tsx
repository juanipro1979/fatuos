import { useMemo, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { native } from "../lib/native";
import type { ChartSpec, ImageSpec } from "../agent/types";

export type Widget =
  | { id: string; kind: "chart"; spec: ChartSpec; x: number; y: number }
  | { id: string; kind: "image"; spec: ImageSpec; x: number; y: number };

function useDrag(onMove: (dx: number, dy: number) => void) {
  const last = useRef<{ x: number; y: number } | null>(null);
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if ((e.target as HTMLElement).closest("button")) return;
      last.current = { x: e.clientX, y: e.clientY };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (!last.current) return;
      onMove(e.clientX - last.current.x, e.clientY - last.current.y);
      last.current = { x: e.clientX, y: e.clientY };
    },
    onPointerUp: () => (last.current = null),
  };
}

export function WidgetFrame({
  w,
  onClose,
  onMove,
  children,
  title,
  accent,
}: {
  w: Widget;
  onClose: () => void;
  onMove: (dx: number, dy: number) => void;
  children: React.ReactNode;
  title: string;
  accent: string;
}) {
  const drag = useDrag(onMove);
  return (
    <div className="widget hit pop-in" style={{ left: w.x, top: w.y, ["--accent" as string]: accent }}>
      <div className="widget-head" {...drag}>
        <span className="widget-title">{title}</span>
        <button className="icon-btn" onClick={onClose} aria-label="Cerrar">
          ×
        </button>
      </div>
      {children}
    </div>
  );
}

export function ChartView({ spec, accent }: { spec: ChartSpec; accent: string }) {
  const W = 340;
  const H = 150;
  const pad = { l: 8, r: 8, t: 10, b: 18 };
  const [hover, setHover] = useState<number | null>(null);
  const { path, area, xs, ys, min, max } = useMemo(() => {
    const vals = spec.points.map((p) => p.value);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const span = max - min || 1;
    const xs = spec.points.map((_, i) => pad.l + (i / Math.max(1, spec.points.length - 1)) * (W - pad.l - pad.r));
    const ys = vals.map((v) => pad.t + (1 - (v - min) / span) * (H - pad.t - pad.b));
    const path = xs.map((x, i) => `${i ? "L" : "M"}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
    const area = `${path} L${xs.at(-1)},${H - pad.b} L${xs[0]},${H - pad.b} Z`;
    return { path, area, xs, ys, min, max };
  }, [spec]);

  const up = (spec.highlight?.change ?? spec.points.at(-1)!.value - spec.points[0].value) >= 0;
  const color = spec.highlight ? (up ? "#3fdc8f" : "#ff5f7e") : accent;
  const fmt = (v: number) => v.toLocaleString("es-AR", { maximumFractionDigits: v < 10 ? 3 : 2 });

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    xs.forEach((xx, i) => Math.abs(xx - x) < Math.abs(xs[best] - x) && (best = i));
    setHover(best);
  };

  if (!spec.points.length) return <div className="widget-body muted">Sin datos</div>;
  const hp = hover != null ? spec.points[hover] : null;
  return (
    <div className="widget-body">
      <div className="chart-head">
        <div>
          <div className="chart-value">{hp ? `${fmt(hp.value)} ${spec.unit ?? ""}` : spec.highlight?.value ?? `${fmt(spec.points.at(-1)!.value)} ${spec.unit ?? ""}`}</div>
          <div className="chart-sub">{hp ? hp.label : spec.subtitle}</div>
        </div>
        {spec.highlight?.change != null && !hp && (
          <div className="chart-change" style={{ color }}>
            {up ? "▲" : "▼"} {Math.abs(spec.highlight.change).toFixed(2)}%
          </div>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <defs>
          <linearGradient id="area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.35" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#area)" />
        <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
        {hover != null && (
          <>
            <line x1={xs[hover]} x2={xs[hover]} y1={pad.t} y2={H - pad.b} stroke="#fff" strokeOpacity="0.25" />
            <circle cx={xs[hover]} cy={ys[hover]} r="3.5" fill={color} stroke="#fff" strokeWidth="1.5" />
          </>
        )}
        <text x={W - pad.r} y={pad.t + 2} className="axis" textAnchor="end">{fmt(max)}</text>
        <text x={W - pad.r} y={H - pad.b - 3} className="axis" textAnchor="end">{fmt(min)}</text>
        <text x={pad.l} y={H - 4} className="axis">{spec.points[0].label}</text>
        <text x={W - pad.r} y={H - 4} className="axis" textAnchor="end">{spec.points.at(-1)!.label}</text>
      </svg>
    </div>
  );
}

export function ImageView({ spec, onSaved }: { spec: ImageSpec; onSaved: (path: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const save = async () => {
    setBusy(true);
    setErr("");
    try {
      const name = (spec.title || "imagen").slice(0, 40);
      const path = spec.url.startsWith("data:")
        ? await native.saveBase64(spec.url, name, spec.url.slice(5, spec.url.indexOf(";")))
        : await native.downloadUrl(spec.url, name);
      onSaved(path);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="widget-body">
      <img className="widget-img" src={spec.url} alt={spec.title} draggable={false} />
      <div className="img-foot">
        <span className="muted small" title={spec.credit}>
          {spec.credit}
        </span>
        <div className="row">
          {spec.sourceUrl && (
            <button className="chip" onClick={() => openUrl(spec.sourceUrl!)}>
              Fuente
            </button>
          )}
          {spec.savedPath ? (
            <button className="chip" onClick={() => native.revealFile(spec.savedPath!)}>
              Ver archivo
            </button>
          ) : (
            <button className="chip" disabled={busy} onClick={save}>
              {busy ? "Guardando…" : "Guardar"}
            </button>
          )}
        </div>
      </div>
      {err && <div className="error small">{err}</div>}
    </div>
  );
}
