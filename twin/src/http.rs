//! Minimal HTTP client with retries.
//!
//! Transport is the curl.exe that ships with Windows 10+ (and every Linux/macOS), so the Rust
//! build needs no TLS or OS-binding crates (the GNU toolchain cannot link them without binutils).

use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

pub type Res<T> = Result<T, Box<dyn std::error::Error + Send + Sync>>;

const UA: &str = "gbpuat-twin/0.2 (github.com/teerthasrirathod/gbpuat-pantnagar-digital-twin)";

fn retry<T>(what: &str, mut f: impl FnMut() -> Res<T>) -> Res<T> {
    let mut last = None;
    for attempt in 0..4u32 {
        match f() {
            Ok(v) => return Ok(v),
            Err(e) => {
                eprintln!("  retry {} for {}: {}", attempt + 1, what, e);
                last = Some(e);
                std::thread::sleep(Duration::from_secs(2u64 << attempt));
            }
        }
    }
    Err(last.unwrap())
}

fn tmp(name: &str) -> std::path::PathBuf {
    static N: AtomicU64 = AtomicU64::new(0);
    let d = crate::cog::cache_root().join("tmp");
    let _ = std::fs::create_dir_all(&d);
    d.join(format!("{}-{}-{}", std::process::id(), N.fetch_add(1, Ordering::Relaxed), name))
}

fn curl(args: &[&str]) -> Res<Vec<u8>> {
    let out = Command::new("curl")
        .args(["-sS", "--fail", "-L", "--compressed", "--connect-timeout", "30", "--max-time", "900", "-A", UA])
        .args(args)
        .output()
        .map_err(|e| format!("cannot run curl: {e}"))?;
    if !out.status.success() {
        return Err(format!("curl {}: {}", args.last().unwrap_or(&""), String::from_utf8_lossy(&out.stderr).trim()).into());
    }
    Ok(out.stdout)
}

pub fn get(url: &str) -> Res<Vec<u8>> {
    retry(url, || curl(&[url]))
}

/// Bytes `start..=end` of `url`, plus the total size reported by Content-Range.
pub fn get_range(url: &str, start: u64, end: u64) -> Res<(Vec<u8>, u64)> {
    retry(url, || {
        let hdr = tmp("headers.txt");
        let range = format!("{start}-{end}");
        let out = Command::new("curl")
            .args(["-sS", "--fail", "-L", "--connect-timeout", "30", "--max-time", "600", "-A", UA])
            .args(["-r", &range, "-D", hdr.to_str().unwrap(), url])
            .output()
            .map_err(|e| format!("cannot run curl: {e}"))?;
        let headers = std::fs::read_to_string(&hdr).unwrap_or_default();
        let _ = std::fs::remove_file(&hdr);
        if !out.status.success() {
            return Err(format!("curl range {url}: {}", String::from_utf8_lossy(&out.stderr).trim()).into());
        }
        let total = headers
            .lines()
            .filter(|l| l.to_ascii_lowercase().starts_with("content-range"))
            .last()
            .and_then(|l| l.rsplit('/').next())
            .and_then(|s| s.trim().parse().ok())
            .unwrap_or(0);
        Ok((out.stdout, total))
    })
}

/// POST one urlencoded form field (used for Overpass queries).
pub fn post_form(url: &str, field: &str, value: &str) -> Res<String> {
    retry(url, || {
        let f = tmp("form.txt");
        std::fs::write(&f, value)?;
        let arg = format!("{field}@{}", f.to_str().unwrap());
        let r = curl(&["--data-urlencode", &arg, url]);
        let _ = std::fs::remove_file(&f);
        Ok(String::from_utf8(r?)?)
    })
}
