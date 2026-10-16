//! Tiny static file server for development (the viewer itself also opens straight from disk).

use crate::aoi::root;
use crate::http::Res;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;

fn mime(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "json" => "application/json",
        "css" => "text/css",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        _ => "application/octet-stream",
    }
}

fn handle(mut s: TcpStream, base: PathBuf) {
    let mut reader = BufReader::new(&s);
    let mut line = String::new();
    if reader.read_line(&mut line).is_err() {
        return;
    }
    // Read the rest of the request headers before answering: closing a socket with unread data
    // makes Windows reset the connection and the browser retries.
    let mut h = String::new();
    while reader.read_line(&mut h).map(|n| n > 2).unwrap_or(false) {
        h.clear();
    }
    let raw = line.split_whitespace().nth(1).unwrap_or("/");
    if raw == "/" {
        let _ = write!(s, "HTTP/1.1 302 Found\r\nLocation: /campus/\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        return;
    }
    let path = raw.split(['?', '#']).next().unwrap_or("/");
    let rel = path.trim_start_matches('/');
    let mut file = base.join(if rel.is_empty() { "campus/index.html" } else { rel });
    if file.is_dir() {
        file = file.join("index.html");
    }
    let ok = !rel.contains("..") && file.starts_with(&base);
    let (status, body, ctype) = match (ok, std::fs::read(&file)) {
        (true, Ok(b)) => ("200 OK", b, mime(&file.to_string_lossy())),
        _ => ("404 Not Found", b"not found".to_vec(), "text/plain"),
    };
    let _ = write!(s, "HTTP/1.1 {status}\r\nContent-Type: {ctype}\r\nContent-Length: {}\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n", body.len());
    let _ = s.write_all(&body);
    let _ = s.flush();
    let _ = s.shutdown(std::net::Shutdown::Write);
}

pub fn run(port: u16) -> Res<()> {
    let base = root();
    let listener = TcpListener::bind(("127.0.0.1", port))?;
    println!("serving {} at http://localhost:{port}/campus/", base.display());
    for stream in listener.incoming() {
        let Ok(s) = stream else { continue };
        let base = base.clone();
        std::thread::spawn(move || handle(s, base));
    }
    Ok(())
}
