import { invoke } from "@tauri-apps/api/core";

export type Rect = { x: number; y: number; w: number; h: number };

export const native = {
  setHitRegions: (regions: Rect[]) => invoke("set_hit_regions", { regions }),
  setInteractive: (on: boolean) => invoke("set_interactive", { on }),
  focusOverlay: () => invoke("focus_overlay"),
  showMenu: () => invoke("show_menu"),
  downloadUrl: (url: string, filename?: string) =>
    invoke<string>("download_url", { url, filename: filename ?? null }),
  saveBase64: (data: string, filename: string, mime?: string) =>
    invoke<string>("save_base64", { data, filename, mime: mime ?? null }),
  webGet: (url: string) => invoke<string>("web_get", { url }),
  downloadsPath: () => invoke<string>("downloads_path"),
  openDownloads: () => invoke("open_downloads"),
  revealFile: (path: string) => invoke("reveal_file", { path }),
  secretSet: (provider: string, value: string) => invoke("secret_set", { provider, value }),
  secretGet: (provider: string) => invoke<string | null>("secret_get", { provider }),
  cliAvailable: (kind: string) => invoke<boolean>("cli_available", { kind }),
  runCli: (kind: string, prompt: string) => invoke<string>("run_cli", { kind, prompt }),
  saveCaptureForCli: (data: string) => invoke<string>("save_capture_for_cli", { data }),
};
