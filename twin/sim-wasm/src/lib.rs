//! Plain C-ABI exports for the browser. Strings go in and out as UTF-8 bytes in linear memory:
//! JS calls `alloc`, writes the bytes, calls a function, then reads `out_ptr()`/`out_len()`.

use serde_json::Value;
use sim::*;
use std::cell::RefCell;

#[derive(Default)]
struct State {
    world: Option<World>,
    ctx: Option<Ctx>,
    out: Vec<u8>,
    grid: Vec<f32>,
}

thread_local! {
    static ST: RefCell<State> = RefCell::new(State::default());
    static PANIC: RefCell<String> = RefCell::new(String::new());
}

fn text(p: *const u8, n: usize) -> String {
    let s = unsafe { std::slice::from_raw_parts(p, n) };
    String::from_utf8_lossy(s).into_owned()
}

fn set_out(st: &mut State, v: Value) -> i32 {
    st.out = v.to_string().into_bytes();
    if v.get("ok").and_then(|o| o.as_bool()) == Some(false) { 1 } else { 0 }
}

fn hook() {
    std::panic::set_hook(Box::new(|info| PANIC.with(|p| *p.borrow_mut() = info.to_string())));
}

#[no_mangle]
pub extern "C" fn alloc(n: usize) -> *mut u8 {
    let mut v: Vec<u8> = Vec::with_capacity(n.max(1));
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

#[no_mangle]
pub extern "C" fn free(p: *mut u8, n: usize) {
    unsafe { drop(Vec::from_raw_parts(p, 0, n.max(1))) }
}

#[no_mangle]
pub extern "C" fn out_ptr() -> *const u8 {
    ST.with(|s| s.borrow().out.as_ptr())
}

#[no_mangle]
pub extern "C" fn out_len() -> usize {
    ST.with(|s| s.borrow().out.len())
}

#[no_mangle]
pub extern "C" fn grid_ptr() -> *const f32 {
    ST.with(|s| s.borrow().grid.as_ptr())
}

/// Last panic message (as bytes in `out`), for error reports after a trap.
#[no_mangle]
pub extern "C" fn last_panic() -> usize {
    let m = PANIC.with(|p| p.borrow().clone());
    ST.with(|s| s.borrow_mut().out = m.into_bytes());
    out_len()
}

#[no_mangle]
pub extern "C" fn catalog_json() -> usize {
    ST.with(|s| set_out(&mut s.borrow_mut(), catalog()));
    out_len()
}

/// Loads the campus JSON. Returns 0 on success, otherwise the error is in `out`.
#[no_mangle]
pub extern "C" fn world_load(p: *const u8, n: usize) -> i32 {
    hook();
    let t = text(p, n);
    ST.with(|s| {
        let mut st = s.borrow_mut();
        match World::load(&t) {
            Ok(w) => {
                let msg = serde_json::json!({ "ok": true, "buildings": w.blds.len(), "nodes": w.graph.nodes.len(), "samples": w.samples.len() });
                st.world = Some(w);
                set_out(&mut st, msg)
            }
            Err(e) => set_out(&mut st, serde_json::json!({ "ok": false, "msg": e })),
        }
    })
}

/// Parses and applies a scenario (GeoJSON). Returns 0 on success.
#[no_mangle]
pub extern "C" fn plan_set(p: *const u8, n: usize) -> i32 {
    let t = text(p, n);
    ST.with(|s| {
        let mut st = s.borrow_mut();
        let Some(w) = st.world.as_ref() else { return set_out(&mut st, serde_json::json!({ "ok": false, "msg": "world not loaded" })) };
        match parse(&t, &w.frame) {
            Ok(sc) => {
                let ctx = prepare(w, sc);
                st.ctx = Some(ctx);
                set_out(&mut st, serde_json::json!({ "ok": true }))
            }
            Err(e) => set_out(&mut st, serde_json::json!({ "ok": false, "msg": e })),
        }
    })
}

fn with_ctx(f: impl FnOnce(&World, &Ctx) -> Value) -> usize {
    ST.with(|s| {
        let mut st = s.borrow_mut();
        let v = match (st.world.as_ref(), st.ctx.as_ref()) {
            (Some(w), Some(c)) => f(w, c),
            _ => serde_json::json!({ "ok": false, "msg": "no plan loaded" }),
        };
        set_out(&mut st, v);
        st.out.len()
    })
}

#[no_mangle]
pub extern "C" fn plan_evaluate() -> usize {
    with_ctx(|w, c| evaluate(w, c))
}

#[no_mangle]
pub extern "C" fn plan_route(ax: f64, az: f64, bx: f64, bz: f64, which: u32) -> usize {
    with_ctx(|w, c| route(w, c, which, [ax, az], [bx, bz]))
}

#[no_mangle]
pub extern "C" fn plan_suggest_wifi(p: *const u8, n: usize) -> usize {
    let req: Value = serde_json::from_str(&text(p, n)).unwrap_or(Value::Null);
    with_ctx(|w, c| suggest_wifi(w, c, &req))
}

fn grid_with(f: impl FnOnce(&World, &Ctx) -> Vec<f32>) -> *const f32 {
    ST.with(|s| {
        let mut st = s.borrow_mut();
        let g = match (st.world.as_ref(), st.ctx.as_ref()) {
            (Some(w), Some(c)) => f(w, c),
            _ => Vec::new(),
        };
        st.grid = g;
        st.grid.as_ptr()
    })
}

/// Wi-Fi signal (dBm, -200 = none) on an nx x nz grid for one floor; which 0 = baseline, 1 = plan.
#[no_mangle]
pub extern "C" fn plan_wifi_grid(x0: f64, z0: f64, cell: f64, nx: usize, nz: usize, floor: f64, which: u32) -> *const f32 {
    grid_with(|w, c| wifi_grid(w, if which == 0 { &c.base } else { &c.plan }, x0, z0, cell, nx, nz, floor))
}

/// Illuminance (lux) on an nx x nz grid; which 0 = baseline, 1 = plan.
#[no_mangle]
pub extern "C" fn plan_lux_grid(x0: f64, z0: f64, cell: f64, nx: usize, nz: usize, which: u32) -> *const f32 {
    grid_with(|w, c| lux_grid(w, if which == 0 { &c.base } else { &c.plan }, x0, z0, cell, nx, nz))
}

#[link(wasm_import_module = "env")]
extern "C" {
    fn now() -> f64;
}

/// Timing of the evaluation parts (ms), for performance work.
#[no_mangle]
pub extern "C" fn plan_profile() -> usize {
    with_ctx(|w, c| {
        let t = || unsafe { now() };
        let mut sc = sim::engine::Scratch::default();
        let t0 = t();
        let _ = sim::engine::wifi_eval(w, c, &mut sc);
        let t1 = t();
        let _ = sim::engine::light_eval(w, c);
        let t2 = t();
        let _ = sim::engine::access_eval(w, c);
        let t3 = t();
        let _ = evaluate(w, c);
        let t4 = t();
        serde_json::json!({ "wifi": t1 - t0, "light": t2 - t1, "access": t3 - t2, "all": t4 - t3 })
    })
}
