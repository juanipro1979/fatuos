//! Descargas confinadas a `Escritorio/Fatuos/downloads`.

use base64::Engine;
use std::path::{Path, PathBuf};

pub const BROWSER_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

pub fn downloads_dir() -> Result<PathBuf, String> {
    let base = dirs::desktop_dir()
        .or_else(dirs::home_dir)
        .ok_or("no se encontró el Escritorio")?;
    let dir = base.join("Fatuos").join("downloads");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Deja solo un nombre de archivo seguro: sin rutas, sin `..`, sin caracteres raros.
pub fn sanitize_filename(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or("");
    let cleaned: String = base
        .chars()
        .map(|c| if c.is_alphanumeric() || matches!(c, '-' | '_' | '.' | ' ') { c } else { '_' })
        .collect();
    let cleaned = cleaned.trim().trim_matches('.').to_string();
    let cleaned: String = cleaned.chars().take(80).collect();
    if cleaned.is_empty() { "archivo".into() } else { cleaned }
}

fn ext_for_mime(mime: &str) -> Option<&'static str> {
    let m = mime.split(';').next().unwrap_or("").trim();
    Some(match m {
        "image/jpeg" => "jpg",
        "image/png" => "png",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/svg+xml" => "svg",
        "application/pdf" => "pdf",
        "text/plain" => "txt",
        "text/html" => "html",
        "application/json" => "json",
        "application/zip" => "zip",
        "audio/mpeg" => "mp3",
        "video/mp4" => "mp4",
        _ => return None,
    })
}

/// Evita pisar archivos: vaca.jpg → vaca-1.jpg → vaca-2.jpg …
fn unique_path(dir: &Path, filename: &str) -> PathBuf {
    let candidate = dir.join(filename);
    if !candidate.exists() {
        return candidate;
    }
    let (stem, ext) = match filename.rsplit_once('.') {
        Some((s, e)) => (s.to_string(), format!(".{e}")),
        None => (filename.to_string(), String::new()),
    };
    (1..10_000)
        .map(|i| dir.join(format!("{stem}-{i}{ext}")))
        .find(|p| !p.exists())
        .unwrap_or(candidate)
}

fn finalize_name(filename: &str, mime: Option<&str>) -> String {
    let mut name = sanitize_filename(filename);
    if !name.contains('.') {
        if let Some(ext) = mime.and_then(ext_for_mime) {
            name = format!("{name}.{ext}");
        }
    }
    name
}

pub fn check_url(url: &str) -> Result<(), String> {
    if url.starts_with("https://") || url.starts_with("http://") {
        Ok(())
    } else {
        Err("solo se permiten URLs http(s)".into())
    }
}

pub async fn download(url: String, filename: Option<String>) -> Result<String, String> {
    check_url(&url)?;
    let client = reqwest::Client::builder()
        .user_agent(BROWSER_UA)
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("la descarga falló: HTTP {}", resp.status()));
    }
    let mime = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(String::from);
    let fallback = url
        .split(['?', '#'])
        .next()
        .and_then(|u| u.rsplit('/').next())
        .filter(|s| !s.is_empty())
        .unwrap_or("archivo")
        .to_string();
    let name = finalize_name(filename.as_deref().unwrap_or(&fallback), mime.as_deref());
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() > 200 * 1024 * 1024 {
        return Err("el archivo pesa más de 200 MB".into());
    }
    let path = unique_path(&downloads_dir()?, &name);
    std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

pub fn save_base64(data: &str, filename: &str, mime: Option<&str>) -> Result<String, String> {
    let raw = data.split_once(',').map(|(_, d)| d).unwrap_or(data);
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(raw.trim())
        .map_err(|e| e.to_string())?;
    let name = finalize_name(filename, mime);
    let path = unique_path(&downloads_dir()?, &name);
    std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

pub async fn web_get(url: String) -> Result<String, String> {
    check_url(&url)?;
    let client = reqwest::Client::builder()
        .user_agent(BROWSER_UA)
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(&url)
        .header("Accept-Language", "es-AR,es;q=0.9,en;q=0.8")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("HTTP {status}"));
    }
    Ok(text.chars().take(2_000_000).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_strips_paths() {
        assert_eq!(sanitize_filename("../../etc/passwd"), "passwd");
        assert_eq!(sanitize_filename("C:\\Windows\\evil.exe"), "evil.exe");
        assert_eq!(sanitize_filename(".."), "archivo");
        assert_eq!(sanitize_filename("vaca linda.jpg"), "vaca linda.jpg");
        assert_eq!(sanitize_filename("a:b*c?.png"), "a_b_c_.png");
    }

    #[test]
    fn adds_extension_from_mime() {
        assert_eq!(finalize_name("vaca", Some("image/jpeg")), "vaca.jpg");
        assert_eq!(finalize_name("vaca.png", Some("image/jpeg")), "vaca.png");
    }

    #[test]
    fn rejects_non_http() {
        assert!(check_url("file:///C:/x").is_err());
        assert!(check_url("https://x.com").is_ok());
    }
}
