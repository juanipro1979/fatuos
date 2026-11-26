mod files;

use base64::Engine;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::Duration;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, ShortcutState};
use tauri_plugin_opener::OpenerExt;

const OVERLAY: &str = "overlay";
const MENU: &str = "menu";

#[derive(Clone, Copy, Deserialize, Debug)]
struct Rect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

#[derive(Default)]
struct OverlayState {
    /// Zonas (en px lógicos del overlay) donde el mouse NO atraviesa la ventana.
    regions: Vec<Rect>,
    /// Captura o chat: la ventana entera recibe el mouse.
    forced: bool,
}

#[derive(Serialize, Clone)]
struct CursorPayload {
    x: f64,
    y: f64,
}

fn overlay(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(OVERLAY)
}

// ───────────────────────── Comandos ─────────────────────────

#[tauri::command]
fn set_hit_regions(state: tauri::State<Mutex<OverlayState>>, regions: Vec<Rect>) {
    state.lock().unwrap().regions = regions;
}

#[tauri::command]
fn set_interactive(app: AppHandle, state: tauri::State<Mutex<OverlayState>>, on: bool) {
    state.lock().unwrap().forced = on;
    if let Some(w) = overlay(&app) {
        let _ = w.set_ignore_cursor_events(!on);
        if on {
            let _ = w.set_focus();
        }
    }
}

#[tauri::command]
fn log_line(window: tauri::Window, msg: String) {
    eprintln!("[{}] {}", window.label(), msg);
}

#[tauri::command]
fn focus_overlay(app: AppHandle) {
    if let Some(w) = overlay(&app) {
        let _ = w.set_focus();
    }
}

#[tauri::command]
fn show_menu(app: AppHandle) {
    open_menu(&app);
}

#[tauri::command]
async fn download_url(url: String, filename: Option<String>) -> Result<String, String> {
    files::download(url, filename).await
}

#[tauri::command]
fn save_base64(data: String, filename: String, mime: Option<String>) -> Result<String, String> {
    files::save_base64(&data, &filename, mime.as_deref())
}

#[tauri::command]
async fn web_get(url: String) -> Result<String, String> {
    files::web_get(url).await
}

#[tauri::command]
fn downloads_path() -> Result<String, String> {
    files::downloads_dir().map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
fn open_downloads(app: AppHandle) -> Result<(), String> {
    let dir = files::downloads_dir()?;
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn reveal_file(app: AppHandle, path: String) -> Result<(), String> {
    let dir = files::downloads_dir()?;
    let p = std::path::PathBuf::from(&path);
    if !p.starts_with(&dir) {
        return Err("solo se pueden mostrar archivos de la carpeta de Fatuos".into());
    }
    app.opener().reveal_item_in_dir(p).map_err(|e| e.to_string())
}

// Llavero del sistema para las API keys
#[tauri::command]
fn secret_set(provider: String, value: String) -> Result<(), String> {
    let e = keyring::Entry::new("fatuos", &provider).map_err(|e| e.to_string())?;
    if value.is_empty() {
        let _ = e.delete_credential();
        Ok(())
    } else {
        e.set_password(&value).map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn secret_get(provider: String) -> Option<String> {
    keyring::Entry::new("fatuos", &provider)
        .ok()?
        .get_password()
        .ok()
}

// Claude Code / OpenCode como proveedores
fn cli_bin(kind: &str) -> Result<&'static str, String> {
    match kind {
        "claude-code" => Ok("claude"),
        "opencode" => Ok("opencode"),
        _ => Err("CLI desconocido".into()),
    }
}

#[tauri::command]
fn cli_available(kind: String) -> bool {
    cli_bin(&kind).map(|b| which::which(b).is_ok()).unwrap_or(false)
}

#[tauri::command]
async fn run_cli(kind: String, prompt: String) -> Result<String, String> {
    let bin = which::which(cli_bin(&kind)?).map_err(|_| format!("{kind} no está instalado"))?;
    let cwd = files::downloads_dir()?;
    tauri::async_runtime::spawn_blocking(move || {
        use std::io::Write;
        use std::process::{Command, Stdio};
        let mut cmd = Command::new(&bin);
        cmd.current_dir(&cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
        if kind == "claude-code" {
            // El prompt va por stdin: nada de interpolar texto en la línea de comandos.
            cmd.args(["-p", "--output-format", "json"]);
        } else {
            let one_line: String = prompt.replace(['\r', '\n'], " ").chars().take(30_000).collect();
            cmd.arg("run").arg(one_line);
        }
        let mut child = cmd.spawn().map_err(|e| e.to_string())?;
        if let Some(mut stdin) = child.stdin.take() {
            if kind == "claude-code" {
                stdin.write_all(prompt.as_bytes()).map_err(|e| e.to_string())?;
            }
        }
        let out = child.wait_with_output().map_err(|e| e.to_string())?;
        let stdout = String::from_utf8_lossy(&out.stdout).to_string();
        if !out.status.success() && stdout.trim().is_empty() {
            return Err(String::from_utf8_lossy(&out.stderr).chars().take(800).collect());
        }
        if kind == "claude-code" {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&stdout) {
                if let Some(r) = v.get("result").and_then(|r| r.as_str()) {
                    return Ok(r.to_string());
                }
            }
        }
        Ok(stdout)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Guarda la última captura donde los CLIs pueden leerla.
#[tauri::command]
fn save_capture_for_cli(data: String) -> Result<String, String> {
    let raw = data.split_once(',').map(|(_, d)| d).unwrap_or(&data);
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(raw.trim())
        .map_err(|e| e.to_string())?;
    let path = files::downloads_dir()?.join(".captura-fatuos.jpg");
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

// ───────────────────────── Captura de pantalla ─────────────────────────

fn capture_at(x: i32, y: i32) -> Result<String, String> {
    use image::{codecs::jpeg::JpegEncoder, imageops::FilterType, DynamicImage};
    let monitor = xcap::Monitor::from_point(x, y).map_err(|e| e.to_string())?;
    let img = monitor.capture_image().map_err(|e| e.to_string())?;
    let mut dynimg = DynamicImage::ImageRgba8(img);
    if dynimg.width() > 1920 {
        let h = (dynimg.height() as f64 * 1920.0 / dynimg.width() as f64) as u32;
        dynimg = dynimg.resize_exact(1920, h, FilterType::Triangle);
    }
    let rgb = dynimg.to_rgb8();
    let mut buf = Vec::new();
    JpegEncoder::new_with_quality(&mut buf, 82)
        .encode_image(&rgb)
        .map_err(|e| e.to_string())?;
    Ok(format!(
        "data:image/jpeg;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(buf)
    ))
}

fn start_capture(app: &AppHandle) {
    let app = app.clone();
    let _ = app.emit_to(OVERLAY, "capture-prepare", ());
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(180));
        let pos = app.cursor_position().unwrap_or(PhysicalPosition::new(0.0, 0.0));
        match capture_at(pos.x as i32, pos.y as i32) {
            Ok(image) => {
                if let Some(state) = app.try_state::<Mutex<OverlayState>>() {
                    state.lock().unwrap().forced = true;
                }
                if let Some(w) = overlay(&app) {
                    let _ = w.set_ignore_cursor_events(false);
                    let _ = w.set_focus();
                }
                let _ = app.emit_to(OVERLAY, "capture-ready", image);
            }
            Err(e) => {
                let _ = app.emit_to(OVERLAY, "capture-error", e);
            }
        }
    });
}

// ───────────────────────── Ventanas y bandeja ─────────────────────────

fn open_menu(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(MENU) {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn summon(app: &AppHandle) {
    if let Some(w) = overlay(app) {
        let _ = w.set_focus();
    }
    let _ = app.emit_to(OVERLAY, "summon", ());
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show_menu", "Mostrar menú", true, None::<&str>)?;
    let summon_i = MenuItem::with_id(app, "summon", "Invocar fatuo  (Alt+D)", true, None::<&str>)?;
    let capture = MenuItem::with_id(app, "capture", "Mirar mi pantalla  (Alt+Espacio)", true, None::<&str>)?;
    let pause = CheckMenuItem::with_id(app, "pause", "Pausar fatuos", true, false, None::<&str>)?;
    let folder = MenuItem::with_id(app, "folder", "Abrir carpeta de descargas", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Salir", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&show, &sep, &summon_i, &capture, &pause, &folder, &sep2, &quit])?;

    let pause_ref = pause.clone();
    TrayIconBuilder::with_id("fatuos")
        .icon(app.default_window_icon().cloned().expect("icono"))
        .tooltip("Fatuos")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "show_menu" => open_menu(app),
            "summon" => summon(app),
            "capture" => start_capture(app),
            "folder" => {
                if let Ok(dir) = files::downloads_dir() {
                    let _ = app.opener().open_path(dir.to_string_lossy(), None::<&str>);
                }
            }
            "pause" => {
                let paused = pause_ref.is_checked().unwrap_or(false);
                let _ = app.emit("paused", paused);
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                summon(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

/// Pone el overlay sobre el monitor donde está el cursor.
fn fit_overlay(w: &WebviewWindow, m: &tauri::Monitor) {
    let _ = w.set_position(*m.position());
    let _ = w.set_size(PhysicalSize::new(m.size().width, m.size().height));
}

/// Hilo que sigue al cursor: lo informa al overlay y decide si el mouse atraviesa la ventana.
fn spawn_cursor_loop(app: AppHandle) {
    std::thread::spawn(move || {
        let mut last_hit: Option<bool> = None;
        let mut last_pos = (f64::NAN, f64::NAN);
        let mut current_monitor: Option<(i32, i32)> = None;
        loop {
            std::thread::sleep(Duration::from_millis(16));
            let Some(w) = overlay(&app) else { continue };
            let Ok(pos) = app.cursor_position() else { continue };
            let forced = app
                .try_state::<Mutex<OverlayState>>()
                .map(|s| s.lock().unwrap().forced)
                .unwrap_or(false);

            if !forced {
                if let Ok(Some(m)) = app.monitor_from_point(pos.x, pos.y) {
                    let key = (m.position().x, m.position().y);
                    if current_monitor != Some(key) {
                        current_monitor = Some(key);
                        fit_overlay(&w, &m);
                    }
                }
            }

            let origin = w.outer_position().unwrap_or(PhysicalPosition::new(0, 0));
            let scale = w.scale_factor().unwrap_or(1.0);
            let rx = (pos.x - origin.x as f64) / scale;
            let ry = (pos.y - origin.y as f64) / scale;

            if (rx - last_pos.0).abs() > 0.5 || (ry - last_pos.1).abs() > 0.5 || last_pos.0.is_nan() {
                last_pos = (rx, ry);
                let _ = app.emit_to(OVERLAY, "cursor", CursorPayload { x: rx, y: ry });
            }

            let hit = forced
                || app
                    .try_state::<Mutex<OverlayState>>()
                    .map(|s| {
                        s.lock().unwrap().regions.iter().any(|r| {
                            rx >= r.x && rx <= r.x + r.w && ry >= r.y && ry <= r.y + r.h
                        })
                    })
                    .unwrap_or(false);
            if last_hit != Some(hit) {
                last_hit = Some(hit);
                let _ = w.set_ignore_cursor_events(!hit);
            }
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| open_menu(app)))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    if shortcut.matches(Modifiers::ALT, Code::Space) {
                        start_capture(app);
                    } else if shortcut.matches(Modifiers::ALT, Code::KeyD) {
                        summon(app);
                    }
                })
                .build(),
        )
        .manage(Mutex::new(OverlayState::default()))
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            build_tray(app.handle())?;

            for sc in ["alt+space", "alt+d"] {
                if let Err(e) = app.global_shortcut().register(sc) {
                    eprintln!("no se pudo registrar {sc}: {e}");
                }
            }

            if let Some(w) = overlay(app.handle()) {
                if let Ok(Some(m)) = w.current_monitor() {
                    fit_overlay(&w, &m);
                }
                let _ = w.set_ignore_cursor_events(true);
                let _ = w.set_always_on_top(true);
            }
            spawn_cursor_loop(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == MENU {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            log_line,
            set_hit_regions,
            set_interactive,
            focus_overlay,
            show_menu,
            download_url,
            save_base64,
            web_get,
            downloads_path,
            open_downloads,
            reveal_file,
            secret_set,
            secret_get,
            cli_available,
            run_cli,
            save_capture_for_cli,
        ])
        .run(tauri::generate_context!())
        .expect("error al iniciar Fatuos");
}
