//! Single-file bundle: inline every <script src> of campus/index.html into one HTML file that
//! opens from disk with no server (GBPUAT-Campus-3D.html at the repository root).

use crate::aoi::root;
use crate::http::Res;

pub fn run() -> Res<()> {
    let dir = root().join("campus");
    let html = std::fs::read_to_string(dir.join("index.html"))?;
    let mut out = String::with_capacity(16 << 20);
    let mut rest = html.as_str();
    let mut n = 0;
    while let Some(i) = rest.find("<script src=\"") {
        out.push_str(&rest[..i]);
        let after = &rest[i + 13..];
        let j = after.find('"').ok_or("unterminated script src")?;
        let src = &after[..j];
        let end = after.find("</script>").ok_or("unterminated script tag")? + 9;
        let code = std::fs::read_to_string(dir.join(src)).map_err(|e| format!("{src}: {e}"))?;
        out.push_str("<script>\n");
        out.push_str(&code.replace("</script", "<\\/script"));
        out.push_str("\n</script>");
        rest = &after[end..];
        n += 1;
    }
    out.push_str(rest);
    let path = root().join("GBPUAT-Campus-3D.html");
    std::fs::write(&path, &out)?;
    println!("  inlined {n} scripts -> {} ({:.2} MB)", path.display(), out.len() as f64 / 1e6);
    Ok(())
}
