//! Road network: straight edges between nodes, a grid index for snapping, Dijkstra, and
//! insertion of new roads that join the existing network (endpoint snapping + crossings).

use crate::geo::*;
use std::cmp::{Ordering, Reverse};
use std::collections::BinaryHeap;

/// Road references at or above this value are scenario items (item index = road - NEW_ROAD).
pub const NEW_ROAD: u32 = 1_000_000;

#[derive(Clone, Copy, PartialEq)]
struct Ord64(f64);
impl Eq for Ord64 {}
impl PartialOrd for Ord64 {
    fn partial_cmp(&self, o: &Self) -> Option<Ordering> {
        Some(self.cmp(o))
    }
}
impl Ord for Ord64 {
    fn cmp(&self, o: &Self) -> Ordering {
        self.0.total_cmp(&o.0)
    }
}

#[derive(Clone)]
pub struct Edge {
    pub a: u32,
    pub b: u32,
    pub len: f64,
    pub road: u32,
    pub on: bool,
}

#[derive(Clone)]
pub struct Graph {
    pub nodes: Vec<P>,
    pub edges: Vec<Edge>,
    pub adj: Vec<Vec<u32>>,
    pub grid: Grid,
    /// Sizes of the world graph (everything after these was added by a scenario).
    pub base_nodes: usize,
    pub base_edges: usize,
}

pub struct Snap {
    pub k: u32,
    pub t: f64,
    pub d: f64,
}

impl Graph {
    pub fn new(bounds: [f64; 4], nodes: Vec<P>, edges: &[[u32; 3]]) -> Self {
        let mut g = Graph { adj: vec![Vec::new(); nodes.len()], nodes, edges: Vec::new(), grid: Grid::new(bounds, 60.0), base_nodes: 0, base_edges: 0 };
        // Every edge is kept (even degenerate ones, switched off) so indices match the viewer's.
        let n = g.nodes.len() as u32;
        for e in edges {
            let (a, b) = (e[0].min(n - 1), e[1].min(n - 1));
            let k = g.add_edge(a, b, e[2]);
            if a == b || e[0] >= n || e[1] >= n {
                g.disable_edge(k);
            }
        }
        g.base_nodes = g.nodes.len();
        g.base_edges = g.edges.len();
        g
    }

    pub fn add_node(&mut self, p: P) -> u32 {
        self.nodes.push(p);
        self.adj.push(Vec::new());
        (self.nodes.len() - 1) as u32
    }

    pub fn add_edge(&mut self, a: u32, b: u32, road: u32) -> u32 {
        let pa = self.nodes[a as usize];
        let pb = self.nodes[b as usize];
        let k = self.edges.len() as u32;
        self.edges.push(Edge { a, b, len: dist(pa, pb), road, on: true });
        self.adj[a as usize].push(k);
        self.adj[b as usize].push(k);
        self.grid.insert_bb([pa[0].min(pb[0]), pa[1].min(pb[1]), pa[0].max(pb[0]), pa[1].max(pb[1])], k);
        k
    }

    pub fn disable_edge(&mut self, k: u32) {
        let e = &mut self.edges[k as usize];
        if !e.on {
            return;
        }
        e.on = false;
        let (a, b) = (e.a as usize, e.b as usize);
        self.adj[a].retain(|&x| x != k);
        self.adj[b].retain(|&x| x != k);
    }

    pub fn other(&self, k: u32, n: u32) -> u32 {
        let e = &self.edges[k as usize];
        if e.a == n {
            e.b
        } else {
            e.a
        }
    }

    /// Nearest enabled edge within max_d (optionally skipping edges of one road). Searches a
    /// small radius first: anything found within the searched radius is the true nearest.
    pub fn nearest_edge(&self, p: P, max_d: f64, skip_road: Option<u32>) -> Option<Snap> {
        let mut r = max_d.min(40.0);
        loop {
            let best = self.nearest_edge_in(p, r, skip_road);
            if best.is_some() || r >= max_d {
                return best;
            }
            r = (r * 3.0).min(max_d);
        }
    }

    fn nearest_edge_in(&self, p: P, max_d: f64, skip_road: Option<u32>) -> Option<Snap> {
        let mut best: Option<Snap> = None;
        self.grid.query_bb([p[0] - max_d, p[1] - max_d, p[0] + max_d, p[1] + max_d], |k| {
            let e = &self.edges[k as usize];
            if !e.on || Some(e.road) == skip_road {
                return;
            }
            let (d, t) = seg_dist(p, self.nodes[e.a as usize], self.nodes[e.b as usize]);
            if d <= max_d && best.as_ref().map_or(true, |b| d < b.d) {
                best = Some(Snap { k, t, d });
            }
        });
        best
    }

    pub fn nearest_node(&self, p: P, max_d: f64, skip_road: Option<u32>) -> Option<u32> {
        let mut best: Option<(u32, f64)> = None;
        self.grid.query_bb([p[0] - max_d, p[1] - max_d, p[0] + max_d, p[1] + max_d], |k| {
            let e = &self.edges[k as usize];
            if !e.on || Some(e.road) == skip_road {
                return;
            }
            for n in [e.a, e.b] {
                let d = dist(p, self.nodes[n as usize]);
                if d <= max_d && best.map_or(true, |b| d < b.1) {
                    best = Some((n, d));
                }
            }
        });
        best.map(|b| b.0)
    }

    /// Splits edge k at parameter t; returns the new node.
    pub fn split(&mut self, k: u32, t: f64) -> u32 {
        let (a, b, road) = {
            let e = &self.edges[k as usize];
            (e.a, e.b, e.road)
        };
        let pa = self.nodes[a as usize];
        let pb = self.nodes[b as usize];
        let n = self.add_node([pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t]);
        self.disable_edge(k);
        self.add_edge(a, n, road);
        self.add_edge(n, b, road);
        n
    }

    /// Node for a road end: an existing node, a split point on a nearby edge, or a new free end.
    fn attach(&mut self, p: P, snap: f64, road: u32) -> (u32, bool) {
        if let Some(n) = self.nearest_node(p, snap.min(8.0), Some(road)) {
            return (n, true);
        }
        if let Some(s) = self.nearest_edge(p, snap, Some(road)) {
            let e = &self.edges[s.k as usize];
            let (a, b, len) = (e.a, e.b, e.len);
            if s.t * len < 2.0 {
                return (a, true);
            }
            if (1.0 - s.t) * len < 2.0 {
                return (b, true);
            }
            return (self.split(s.k, s.t), true);
        }
        (self.add_node(p), false)
    }

    /// Adds a polyline as new edges joined to the network. Returns (junctions made, nodes of the line).
    pub fn insert_line(&mut self, pts: &[P], road: u32, snap: f64) -> (usize, Vec<u32>) {
        let mut out = Vec::new();
        if pts.len() < 2 {
            return (0, out);
        }
        let (first, j0) = self.attach(pts[0], snap, road);
        let mut junctions = j0 as usize;
        let mut prev = first;
        out.push(first);
        let mut cand: Vec<u32> = Vec::new();
        for si in 0..pts.len() - 1 {
            let a = pts[si];
            let b = pts[si + 1];
            cand.clear();
            self.grid.query_seg(a, b, |k| cand.push(k));
            cand.sort_unstable();
            cand.dedup();
            let mut hits: Vec<(f64, u32, f64)> = Vec::new();
            for &k in &cand {
                let e = &self.edges[k as usize];
                if !e.on || e.road == road {
                    continue;
                }
                if let Some((t, u)) = seg_x(a, b, self.nodes[e.a as usize], self.nodes[e.b as usize]) {
                    let l = dist(a, b);
                    if t * l > 1.0 && (1.0 - t) * l > 1.0 {
                        hits.push((t, k, u));
                    }
                }
            }
            hits.sort_by(|x, y| x.0.total_cmp(&y.0));
            for (_, k, u) in hits {
                if !self.edges[k as usize].on {
                    continue;
                }
                let (ea, eb, len) = {
                    let e = &self.edges[k as usize];
                    (e.a, e.b, e.len)
                };
                let node = if u * len < 2.0 {
                    ea
                } else if (1.0 - u) * len < 2.0 {
                    eb
                } else {
                    self.split(k, u)
                };
                if node != prev {
                    self.add_edge(prev, node, road);
                    prev = node;
                    out.push(node);
                }
                junctions += 1;
            }
            let last = si == pts.len() - 2;
            let nb = if last {
                let (n, j) = self.attach(b, snap, road);
                junctions += j as usize;
                n
            } else {
                self.add_node(b)
            };
            if nb != prev {
                self.add_edge(prev, nb, road);
                prev = nb;
                out.push(nb);
            }
        }
        (junctions, out)
    }

    /// Multi-source Dijkstra. Returns distance per node and the edge used to reach it.
    pub fn dijkstra(&self, src: &[(u32, f64)], limit: f64) -> (Vec<f64>, Vec<i64>) {
        let n = self.nodes.len();
        let mut d = vec![f64::INFINITY; n];
        let mut pred = vec![-1i64; n];
        let mut h = BinaryHeap::new();
        for &(s, d0) in src {
            if d0 < d[s as usize] {
                d[s as usize] = d0;
                h.push(Reverse((Ord64(d0), s)));
            }
        }
        while let Some(Reverse((Ord64(du), u))) = h.pop() {
            if du > d[u as usize] || du > limit {
                continue;
            }
            for &k in &self.adj[u as usize] {
                let e = &self.edges[k as usize];
                let v = if e.a == u { e.b } else { e.a };
                let nd = du + e.len;
                if nd < d[v as usize] {
                    d[v as usize] = nd;
                    pred[v as usize] = k as i64;
                    h.push(Reverse((Ord64(nd), v)));
                }
            }
        }
        (d, pred)
    }

    /// Network distance from a snapped point given node distances.
    pub fn dist_at(&self, d: &[f64], s: &Snap) -> f64 {
        let e = &self.edges[s.k as usize];
        (d[e.a as usize] + s.t * e.len).min(d[e.b as usize] + (1.0 - s.t) * e.len) + s.d
    }

    pub fn snap_sources(&self, s: &Snap) -> [(u32, f64); 2] {
        let e = &self.edges[s.k as usize];
        [(e.a, s.d + s.t * e.len), (e.b, s.d + (1.0 - s.t) * e.len)]
    }

    pub fn point_on(&self, s: &Snap) -> P {
        let e = &self.edges[s.k as usize];
        let a = self.nodes[e.a as usize];
        let b = self.nodes[e.b as usize];
        [a[0] + (b[0] - a[0]) * s.t, a[1] + (b[1] - a[1]) * s.t]
    }
}
