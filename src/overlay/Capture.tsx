import { useEffect, useRef, useState } from "react";

type Stroke = { color: string; pts: { x: number; y: number }[] };
const COLORS = ["#ff3b6b", "#ffd23f", "#38c8f0", "#3fdc8f"];

/** Pantalla congelada + lienzo para marcar. Devuelve la imagen con las marcas. */
export function Capture({
  image,
  onSend,
  onCancel,
}: {
  image: string;
  onSend: (composite: string, question: string) => void;
  onCancel: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [color, setColor] = useState(COLORS[0]);
  const [question, setQuestion] = useState("");
  const drawing = useRef<Stroke | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const c = canvasRef.current!;
    c.width = window.innerWidth * devicePixelRatio;
    c.height = window.innerHeight * devicePixelRatio;
    redraw(strokes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "z" && (e.ctrlKey || e.metaKey)) setStrokes((s) => s.slice(0, -1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  useEffect(() => redraw(strokes), [strokes]);

  function paint(ctx: CanvasRenderingContext2D, list: Stroke[], scale: number) {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const s of list) {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 5 * scale;
      ctx.shadowColor = s.color;
      ctx.shadowBlur = 6 * scale;
      ctx.beginPath();
      s.pts.forEach((p, i) => (i ? ctx.lineTo(p.x * scale, p.y * scale) : ctx.moveTo(p.x * scale, p.y * scale)));
      ctx.stroke();
    }
  }

  function redraw(list: Stroke[]) {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    paint(ctx, drawing.current ? [...list, drawing.current] : list, devicePixelRatio);
  }

  const down = (e: React.PointerEvent) => {
    drawing.current = { color, pts: [{ x: e.clientX, y: e.clientY }] };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    drawing.current.pts.push({ x: e.clientX, y: e.clientY });
    redraw(strokes);
  };
  const up = () => {
    const done = drawing.current;
    drawing.current = null;
    if (done && done.pts.length) setStrokes((s) => [...s, done]);
    inputRef.current?.focus();
  };

  const send = async () => {
    const img = new Image();
    img.src = image;
    await img.decode();
    const out = document.createElement("canvas");
    out.width = img.naturalWidth;
    out.height = img.naturalHeight;
    const ctx = out.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    paint(ctx, strokes, img.naturalWidth / window.innerWidth);
    onSend(out.toDataURL("image/jpeg", 0.85), question.trim() || "¿Qué ves en lo que marqué?");
  };

  return (
    <div className="capture">
      <img src={image} className="capture-img" draggable={false} alt="" />
      <div className="capture-dim" />
      <canvas ref={canvasRef} className="capture-canvas" onPointerDown={down} onPointerMove={move} onPointerUp={up} />
      <div className="capture-hint">Dibujá sobre lo que querés que mire · Ctrl+Z deshace · Esc cancela</div>
      <form
        className="capture-bar pop-in"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <div className="swatches">
          {COLORS.map((c) => (
            <button
              type="button"
              key={c}
              className={`swatch ${c === color ? "on" : ""}`}
              style={{ background: c }}
              onClick={() => setColor(c)}
              aria-label={`Color ${c}`}
            />
          ))}
        </div>
        <input
          ref={inputRef}
          autoFocus
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="¿Qué querés saber de esto?"
        />
        <button type="button" className="ghost" onClick={() => setStrokes([])}>
          Borrar
        </button>
        <button type="button" className="ghost" onClick={onCancel}>
          Cancelar
        </button>
        <button type="submit" className="primary">
          Preguntar
        </button>
      </form>
    </div>
  );
}
