import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./styles/base.css";

import { invoke } from "@tauri-apps/api/core";

const label = getCurrentWindow().label;
const log = (msg: string) => invoke("log_line", { msg }).catch(() => {});
window.addEventListener("error", (e) => log(`error: ${e.message} @ ${e.filename}:${e.lineno}`));
window.addEventListener("unhandledrejection", (e) => log(`rejection: ${String(e.reason)}`));
const origErr = console.error;
console.error = (...a: unknown[]) => (log(`console.error: ${a.map(String).join(" ")}`), origErr(...a));
log(`boot ${innerWidth}x${innerHeight}`);
document.documentElement.dataset.window = label;

class Guard extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(e: Error) {
    log(`render error: ${e.message}`);
    // El overlay nunca debe quedar muerto: se reinicia solo.
    setTimeout(() => this.setState({ failed: false }), 400);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

async function boot() {
  const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
  if (label === "overlay") {
    const { Overlay } = await import("./overlay/Overlay");
    root.render(
      <Guard>
        <Overlay />
      </Guard>,
    );
  } else {
    const { Menu } = await import("./menu/Menu");
    root.render(
      <React.StrictMode>
        <Menu />
      </React.StrictMode>,
    );
  }
}

boot();
