//! The PR's blast radius: which unchanged files depend on the changed ones.
//!
//! Imports are read with tree-sitter (TypeScript and JavaScript, Python, Go and Rust) and resolved to
//! files in the worktree, then followed backwards from the changed files. It's a mechanical reach
//! set: it knows what imports what, not what behaviour changes. Nothing here runs the agent, so the
//! read-only rule is untouched.

use serde::Serialize;
use std::collections::{HashMap, HashSet, VecDeque};
use std::path::Path;
use std::sync::{Arc, Mutex, OnceLock};
use tree_sitter::{Language, Node, Parser, Query, QueryCursor, StreamingIterator};

/// Files bigger than this are usually generated or bundled, and would only slow the scan down.
const MAX_BYTES: u64 = 512 * 1024;
/// Above this many source files the scan stops; a monorepo that size needs a smarter index.
const MAX_FILES: usize = 40_000;
/// How many affected files one answer lists, nearest first.
const MAX_AFFECTED: usize = 80;
/// Hops followed backwards from the changed files.
const MAX_HOPS: u8 = 2;

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
enum Lang {
    Ts,
    Tsx,
    Py,
    Go,
    Rs,
}

impl Lang {
    fn of(path: &str) -> Option<Lang> {
        let ext = path.rsplit_once('.').map(|(_, e)| e)?;
        Some(match ext {
            "ts" | "mts" | "cts" => Lang::Ts,
            "tsx" | "js" | "jsx" | "mjs" | "cjs" => Lang::Tsx,
            "py" => Lang::Py,
            "go" => Lang::Go,
            "rs" => Lang::Rs,
            _ => return None,
        })
    }

    fn name(self) -> &'static str {
        match self {
            Lang::Ts | Lang::Tsx => "TypeScript/JavaScript",
            Lang::Py => "Python",
            Lang::Go => "Go",
            Lang::Rs => "Rust",
        }
    }

    fn language(self) -> Language {
        match self {
            Lang::Ts => tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
            Lang::Tsx => tree_sitter_typescript::LANGUAGE_TSX.into(),
            Lang::Py => tree_sitter_python::LANGUAGE.into(),
            Lang::Go => tree_sitter_go::LANGUAGE.into(),
            Lang::Rs => tree_sitter_rust::LANGUAGE.into(),
        }
    }

    fn query(self) -> &'static str {
        match self {
            Lang::Ts | Lang::Tsx => {
                r#"
                (import_statement source: (string) @s)
                (export_statement source: (string) @s)
                (import_require_clause source: (string) @s)
                ((call_expression function: (identifier) @f arguments: (arguments . (string) @s)) (#eq? @f "require"))
                (call_expression function: (import) arguments: (arguments . (string) @s))
                "#
            }
            Lang::Py => "(import_statement) @imp (import_from_statement) @from",
            Lang::Go => "(import_spec path: (_) @s)",
            Lang::Rs => "(use_declaration argument: (_) @use) (scoped_identifier) @path (scoped_type_identifier) @path",
        }
    }
}

/// What one file asks for, before it's matched to files.
#[derive(Debug, PartialEq)]
enum Raw {
    /// A JS/TS module specifier or a Go import path.
    Spec(String),
    /// `import a.b` (no names) or `from .a import b, c`.
    Py { module: String, names: Vec<String> },
    /// A Rust path: `crate::a::B`, `super::c`, `a::b`.
    Rs(Vec<String>),
}

fn unquote(s: &str) -> String {
    s.trim_matches(|c| c == '"' || c == '\'' || c == '`').to_string()
}

fn text<'a>(n: Node, src: &'a [u8]) -> &'a str {
    n.utf8_text(src).unwrap_or("")
}

/// The imports in one file.
fn extract(parser: &mut Parser, query: &Query, lang: Lang, src: &[u8]) -> Vec<Raw> {
    let Some(tree) = parser.parse(src, None) else { return Vec::new() };
    let mut cursor = QueryCursor::new();
    let mut out = Vec::new();
    let mut matches = cursor.matches(query, tree.root_node(), src);
    while let Some(m) = matches.next() {
        for c in m.captures {
            let name = query.capture_names()[c.index as usize];
            let node = c.node;
            match (lang, name) {
                (Lang::Ts | Lang::Tsx | Lang::Go, "s") => out.push(Raw::Spec(unquote(text(node, src)))),
                (Lang::Py, "imp") => {
                    for n in node.children_by_field_name("name", &mut node.walk()) {
                        let n = if n.kind() == "aliased_import" { n.child_by_field_name("name").unwrap_or(n) } else { n };
                        out.push(Raw::Py { module: text(n, src).to_string(), names: Vec::new() });
                    }
                }
                (Lang::Py, "from") => {
                    let Some(module) = node.child_by_field_name("module_name") else { continue };
                    let names = node
                        .children_by_field_name("name", &mut node.walk())
                        .map(|n| if n.kind() == "aliased_import" { n.child_by_field_name("name").unwrap_or(n) } else { n })
                        .map(|n| text(n, src).to_string())
                        .collect();
                    out.push(Raw::Py { module: text(module, src).to_string(), names });
                }
                (Lang::Rs, "use") => out.extend(expand_use(text(node, src)).into_iter().map(Raw::Rs)),
                (Lang::Rs, "path") => {
                    // Only paths into this crate; `a::b()` without `crate::` is already covered by a `use`.
                    let t = text(node, src);
                    if t.starts_with("crate::") || t.starts_with("super::") || t.starts_with("self::") {
                        out.extend(expand_use(t).into_iter().map(Raw::Rs));
                    }
                }
                _ => {}
            }
        }
    }
    out
}

/// Splits a Rust `use` tree into plain paths: `a::{b, c::{d as e, *}}` gives `a::b` and `a::c::d`.
fn expand_use(s: &str) -> Vec<Vec<String>> {
    let s = s.split_whitespace().collect::<Vec<_>>().join(" ");
    let s = s.trim();
    let Some(open) = top_level_brace(s) else {
        let path = s.split(" as ").next().unwrap_or(s);
        let segs: Vec<String> = path.split("::").map(|p| p.trim().to_string()).filter(|p| !p.is_empty() && p != "*").collect();
        return if segs.is_empty() { Vec::new() } else { vec![segs] };
    };
    let prefix: Vec<String> = s[..open].trim_end_matches("::").split("::").map(|p| p.trim().to_string()).filter(|p| !p.is_empty()).collect();
    let inner = s[open + 1..].strip_suffix('}').unwrap_or(&s[open + 1..]);
    let mut out = Vec::new();
    for item in split_top_level(inner) {
        let item = item.trim();
        if item.is_empty() || item == "*" {
            continue;
        }
        if item == "self" || item.starts_with("self ") {
            out.push(prefix.clone());
            continue;
        }
        for sub in expand_use(item) {
            out.push(prefix.iter().cloned().chain(sub).collect());
        }
    }
    out
}

fn top_level_brace(s: &str) -> Option<usize> {
    s.find('{')
}

fn split_top_level(s: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let (mut depth, mut start) = (0, 0);
    for (i, c) in s.char_indices() {
        match c {
            '{' => depth += 1,
            '}' => depth -= 1,
            ',' if depth == 0 => {
                out.push(&s[start..i]);
                start = i + 1;
            }
            _ => {}
        }
    }
    out.push(&s[start..]);
    out
}

/// `dir` joined with a relative path, with `.` and `..` worked out. `None` if it leaves the repository.
fn join(dir: &str, rel: &str) -> Option<String> {
    let mut parts: Vec<&str> = if dir.is_empty() { Vec::new() } else { dir.split('/').collect() };
    for p in rel.split('/') {
        match p {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            _ => parts.push(p),
        }
    }
    Some(parts.join("/"))
}

fn dir_of(path: &str) -> &str {
    path.rsplit_once('/').map(|(d, _)| d).unwrap_or("")
}

/// Every folder from `dir` up to the repository root, nearest first.
fn ancestors(dir: &str) -> impl Iterator<Item = &str> {
    let mut next = Some(dir);
    std::iter::from_fn(move || {
        let cur = next?;
        next = if cur.is_empty() { None } else { Some(dir_of(cur)) };
        Some(cur)
    })
}

fn at(dir: &str, name: &str) -> String {
    if dir.is_empty() { name.to_string() } else { format!("{dir}/{name}") }
}

/// Whether a path looks like a test, so the map can say so.
pub fn is_test(path: &str) -> bool {
    let name = path.rsplit('/').next().unwrap_or(path);
    let in_dir = |d: &str| path.starts_with(&format!("{d}/")) || path.contains(&format!("/{d}/"));
    in_dir("test") || in_dir("tests") || in_dir("__tests__") || in_dir("spec") || in_dir("e2e")
        || name.contains(".test.") || name.contains(".spec.") || name.ends_with("_test.go")
        || (name.starts_with("test_") && name.ends_with(".py")) || name.ends_with("_test.py")
}

/// Strips `//` and `/* */` comments and trailing commas, so tsconfig.json parses as JSON.
fn loose_json(s: &str) -> Option<serde_json::Value> {
    let b = s.as_bytes();
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    let mut in_str = false;
    while i < b.len() {
        let c = b[i] as char;
        if in_str {
            out.push(c);
            if c == '\\' && i + 1 < b.len() {
                out.push(b[i + 1] as char);
                i += 1;
            } else if c == '"' {
                in_str = false;
            }
        } else if c == '"' {
            in_str = true;
            out.push(c);
        } else if c == '/' && b.get(i + 1) == Some(&b'/') {
            while i < b.len() && b[i] != b'\n' {
                i += 1;
            }
            continue;
        } else if c == '/' && b.get(i + 1) == Some(&b'*') {
            i += 2;
            while i + 1 < b.len() && !(b[i] == b'*' && b[i + 1] == b'/') {
                i += 1;
            }
            i += 2;
            continue;
        } else if c == ',' {
            let rest = s[i + 1..].trim_start();
            if !(rest.starts_with('}') || rest.starts_with(']')) {
                out.push(c);
            }
        } else {
            out.push(c);
        }
        i += 1;
    }
    serde_json::from_str(&out).ok()
}

/// `compilerOptions.paths` from a tsconfig, as (pattern, targets) with targets relative to the repository.
#[derive(Default, Clone)]
struct TsPaths {
    base: Option<String>,
    paths: Vec<(String, Vec<String>)>,
}

/// Matches import paths to files in the worktree.
struct Resolver<'a> {
    root: &'a Path,
    /// Every tracked file, plus the changed ones (deleted files are still imported by someone).
    known: &'a HashSet<String>,
    tsconfigs: Mutex<HashMap<String, Arc<TsPaths>>>,
    /// JS workspace packages: name → folder and package.json.
    packages: HashMap<String, (String, serde_json::Value)>,
    /// Go modules: module path → folder.
    go_modules: Vec<(String, String)>,
    /// Go packages: folder → its non-test files.
    go_packages: HashMap<String, Vec<String>>,
    /// Rust crates: folder with Cargo.toml → crate name (as written in code).
    crates: HashMap<String, String>,
    /// Folders Python imports start from.
    py_roots: Vec<String>,
}

const JS_EXTS: [&str; 10] = [".ts", ".tsx", ".d.ts", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".json"];

impl<'a> Resolver<'a> {
    fn new(root: &'a Path, known: &'a HashSet<String>) -> Self {
        let read = |p: &str| std::fs::read_to_string(root.join(p)).ok();
        let mut packages = HashMap::new();
        let mut go_modules = Vec::new();
        let mut go_packages: HashMap<String, Vec<String>> = HashMap::new();
        let mut crates = HashMap::new();
        let mut py_roots = vec![String::new()];
        for f in known {
            let name = f.rsplit('/').next().unwrap_or(f);
            let dir = dir_of(f).to_string();
            match name {
                "package.json" => {
                    if let Some(v) = read(f).and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
                        && let Some(n) = v.get("name").and_then(|n| n.as_str()) {
                            packages.insert(n.to_string(), (dir.clone(), v.clone()));
                        }
                }
                "go.mod" => {
                    if let Some(m) = read(f).and_then(|s| s.lines().find_map(|l| l.trim().strip_prefix("module ").map(|m| m.trim().trim_matches('"').to_string()))) {
                        go_modules.push((m, dir.clone()));
                    }
                }
                "Cargo.toml" => {
                    if let Some(n) = read(f).and_then(|s| cargo_name(&s)) {
                        crates.insert(dir.clone(), n);
                    }
                }
                "pyproject.toml" | "setup.py" | "setup.cfg" => {
                    py_roots.push(dir.clone());
                }
                _ => {}
            }
            if name.ends_with(".go") && !name.ends_with("_test.go") {
                go_packages.entry(dir).or_default().push(f.clone());
            }
        }
        let extra: Vec<String> = py_roots.iter().map(|r| at(r, "src")).filter(|s| known.iter().any(|k| k.starts_with(&format!("{s}/")))).collect();
        py_roots.extend(extra);
        py_roots.sort();
        py_roots.dedup();
        // Longest module path first, so nested modules win.
        go_modules.sort_by_key(|m| std::cmp::Reverse(m.0.len()));
        Resolver { root, known, tsconfigs: Mutex::new(HashMap::new()), packages, go_modules, go_packages, crates, py_roots }
    }

    fn has(&self, p: &str) -> bool {
        self.known.contains(p)
    }

    fn resolve(&self, from: &str, lang: Lang, raw: &Raw) -> Vec<String> {
        match (lang, raw) {
            (Lang::Ts | Lang::Tsx, Raw::Spec(s)) => self.js(from, s).into_iter().collect(),
            (Lang::Go, Raw::Spec(s)) => self.go(s),
            (Lang::Py, Raw::Py { module, names }) => self.py(from, module, names),
            (Lang::Rs, Raw::Rs(segs)) => self.rs(from, segs).into_iter().collect(),
            _ => Vec::new(),
        }
    }

    // ---- JavaScript and TypeScript ----

    /// The file a path without extension points to: itself, with an extension, or its index file.
    fn js_file(&self, base: &str) -> Option<String> {
        if self.has(base) {
            return Some(base.to_string());
        }
        // ESM TypeScript writes `./x.js` for `./x.ts`.
        for (js, ts) in [(".js", [".ts", ".tsx"]), (".jsx", [".tsx", ".tsx"]), (".mjs", [".mts", ".mts"]), (".cjs", [".cts", ".cts"])] {
            if let Some(stem) = base.strip_suffix(js) {
                for t in ts {
                    let p = format!("{stem}{t}");
                    if self.has(&p) {
                        return Some(p);
                    }
                }
            }
        }
        JS_EXTS
            .iter()
            .map(|e| format!("{base}{e}"))
            .chain(JS_EXTS.iter().map(|e| format!("{}{e}", at(base, "index"))))
            .find(|p| self.has(p))
    }

    fn tsconfig(&self, dir: &str) -> Option<Arc<TsPaths>> {
        for d in ancestors(dir) {
            for name in ["tsconfig.json", "jsconfig.json"] {
                let path = at(d, name);
                if !self.has(&path) {
                    continue;
                }
                if let Some(hit) = self.tsconfigs.lock().ok()?.get(&path) {
                    return Some(hit.clone());
                }
                let parsed = Arc::new(self.read_tsconfig(&path, 0));
                self.tsconfigs.lock().ok()?.insert(path, parsed.clone());
                return Some(parsed);
            }
        }
        None
    }

    fn read_tsconfig(&self, path: &str, depth: u8) -> TsPaths {
        let Some(v) = std::fs::read_to_string(self.root.join(path)).ok().and_then(|s| loose_json(&s)) else { return TsPaths::default() };
        let dir = dir_of(path);
        // A relative `extends` gives the defaults; this file's own options win.
        let mut out = match v.get("extends").and_then(|e| e.as_str()) {
            Some(e) if depth < 3 && e.starts_with('.') => {
                let e = if e.ends_with(".json") { e.to_string() } else { format!("{e}.json") };
                join(dir, &e).map(|p| self.read_tsconfig(&p, depth + 1)).unwrap_or_default()
            }
            _ => TsPaths::default(),
        };
        let opts = v.get("compilerOptions");
        if let Some(b) = opts.and_then(|o| o.get("baseUrl")).and_then(|b| b.as_str()) {
            out.base = join(dir, b);
        }
        if let Some(paths) = opts.and_then(|o| o.get("paths")).and_then(|p| p.as_object()) {
            let base = out.base.clone().unwrap_or_else(|| dir.to_string());
            out.paths = paths
                .iter()
                .map(|(k, t)| (k.clone(), t.as_array().map(|a| a.iter().filter_map(|x| x.as_str()).filter_map(|x| join(&base, x)).collect()).unwrap_or_default()))
                .collect();
        }
        out
    }

    fn js(&self, from: &str, spec: &str) -> Option<String> {
        let spec = spec.split(['?', '#']).next().unwrap_or(spec);
        if spec.is_empty() || spec.starts_with("node:") || spec.contains("://") {
            return None;
        }
        if spec.starts_with('.') {
            return self.js_file(&join(dir_of(from), spec)?);
        }
        if spec.starts_with('/') {
            return self.js_file(spec.trim_start_matches('/'));
        }
        if let Some(cfg) = self.tsconfig(dir_of(from)) {
            for (pattern, targets) in &cfg.paths {
                let hit = match pattern.split_once('*') {
                    Some((pre, post)) => spec.strip_prefix(pre).and_then(|r| r.strip_suffix(post)),
                    None => (pattern == spec).then_some(""),
                };
                if let Some(star) = hit {
                    for t in targets {
                        if let Some(f) = self.js_file(&t.replacen('*', star, 1)) {
                            return Some(f);
                        }
                    }
                }
            }
            if let Some(base) = &cfg.base
                && let Some(f) = self.js_file(&at(base, spec)) {
                    return Some(f);
                }
        }
        self.js_package(spec)
    }

    /// A package from this repository's workspaces: `@acme/ui` or `@acme/ui/button`.
    fn js_package(&self, spec: &str) -> Option<String> {
        let parts: Vec<&str> = spec.split('/').collect();
        let n = if spec.starts_with('@') { 2 } else { 1 };
        if parts.len() < n {
            return None;
        }
        let (dir, pkg) = self.packages.get(&parts[..n].join("/"))?;
        let sub = parts[n..].join("/");
        if !sub.is_empty() {
            return self.js_file(&at(dir, &sub)).or_else(|| self.js_file(&at(&at(dir, "src"), &sub)));
        }
        for field in ["source", "types", "typings", "module", "main"] {
            let Some(entry) = pkg.get(field).and_then(|v| v.as_str()) else { continue };
            let Some(entry) = join(dir, entry) else { continue };
            // Built output points back to the source it's built from.
            let source = entry.replacen(&at(dir, "dist"), &at(dir, "src"), 1).replacen(&at(dir, "lib"), &at(dir, "src"), 1);
            let source = source.strip_suffix(".d.ts").map(str::to_string).unwrap_or(source);
            if let Some(f) = self.js_file(&source).or_else(|| self.js_file(&entry)) {
                return Some(f);
            }
        }
        self.js_file(&at(&at(dir, "src"), "index")).or_else(|| self.js_file(&at(dir, "index")))
    }

    // ---- Go ----

    fn go(&self, import: &str) -> Vec<String> {
        for (module, dir) in &self.go_modules {
            let rest = if import == module {
                ""
            } else if let Some(r) = import.strip_prefix(module.as_str()).and_then(|r| r.strip_prefix('/')) {
                r
            } else {
                continue;
            };
            let pkg = if rest.is_empty() { dir.clone() } else { at(dir, rest) };
            return self.go_packages.get(&pkg).cloned().unwrap_or_default();
        }
        Vec::new()
    }

    // ---- Python ----

    fn py_module(&self, base: &str) -> Option<String> {
        let file = format!("{base}.py");
        if self.has(&file) {
            return Some(file);
        }
        let init = at(base, "__init__.py");
        self.has(&init).then_some(init)
    }

    fn py(&self, from: &str, module: &str, names: &[String]) -> Vec<String> {
        let dots = module.chars().take_while(|c| *c == '.').count();
        let rest = module[dots..].replace('.', "/");
        let bases: Vec<String> = if dots > 0 {
            let mut dir = dir_of(from).to_string();
            for _ in 1..dots {
                if dir.is_empty() {
                    return Vec::new();
                }
                dir = dir_of(&dir).to_string();
            }
            vec![if rest.is_empty() { dir } else { at(&dir, &rest) }]
        } else {
            self.py_roots.iter().map(|r| at(r, &rest)).collect()
        };
        let mut out = Vec::new();
        for base in bases {
            let module_file = self.py_module(&base);
            // `from pkg import mod` imports a submodule when there is one, else a name from pkg.
            let mut used_module = names.is_empty();
            for n in names {
                match self.py_module(&at(&base, n)) {
                    Some(f) => out.push(f),
                    None => used_module = true,
                }
            }
            if used_module {
                out.extend(module_file.clone());
            }
            if module_file.is_some() || !out.is_empty() {
                break;
            }
        }
        out
    }

    // ---- Rust ----

    /// The crate a file belongs to: its Cargo.toml folder.
    fn crate_of<'b>(&self, path: &'b str) -> Option<&'b str> {
        ancestors(dir_of(path)).find(|d| self.crates.contains_key(*d))
    }

    fn rs_module_file(&self, src: &str, segs: &[String]) -> Option<String> {
        if segs.is_empty() {
            return ["lib.rs", "main.rs"].iter().map(|f| at(src, f)).find(|p| self.has(p));
        }
        let base = at(src, &segs.join("/"));
        [format!("{base}.rs"), at(&base, "mod.rs")].into_iter().find(|p| self.has(p))
    }

    /// The module path of a file inside `src`: `src/a/b.rs` is `a::b`, `src/a/mod.rs` is `a`.
    fn rs_module_path(src: &str, path: &str) -> Option<Vec<String>> {
        let rel = if src.is_empty() { path } else { path.strip_prefix(&format!("{src}/"))? };
        let rel = rel.strip_suffix(".rs")?;
        let rel = rel.strip_suffix("/mod").unwrap_or(rel);
        if rel == "lib" || rel == "main" || rel == "mod" {
            return Some(Vec::new());
        }
        Some(rel.split('/').map(str::to_string).collect())
    }

    /// The file a path points into: the deepest module along it.
    fn rs_deepest(&self, src: &str, base: &[String], rest: &[String], allow_base: bool) -> Option<String> {
        for k in (1..=rest.len()).rev() {
            let segs: Vec<String> = base.iter().chain(&rest[..k]).cloned().collect();
            if let Some(f) = self.rs_module_file(src, &segs) {
                return Some(f);
            }
        }
        if allow_base { self.rs_module_file(src, base) } else { None }
    }

    fn rs(&self, from: &str, segs: &[String]) -> Option<String> {
        let first = segs.first()?;
        let krate = self.crate_of(from)?;
        let src = at(krate, "src");
        let here = Self::rs_module_path(&src, from).unwrap_or_default();
        match first.as_str() {
            "crate" => self.rs_deepest(&src, &[], &segs[1..], true),
            "self" => self.rs_deepest(&src, &here, &segs[1..], true),
            "super" => {
                let ups = segs.iter().take_while(|s| *s == "super").count();
                // `here` names the file's own module; in mod.rs/lib.rs that is also the folder.
                let parent = here.len().checked_sub(ups)?;
                self.rs_deepest(&src, &here[..parent], &segs[ups..], true)
            }
            name => {
                // Another crate in this repository, by the name code uses for it.
                if let Some((dir, _)) = self.crates.iter().find(|(_, n)| *n == name) {
                    return self.rs_deepest(&at(dir, "src"), &[], &segs[1..], true);
                }
                // A module next to this one (2018 paths), then one at the crate root.
                self.rs_deepest(&src, &here, segs, false).or_else(|| self.rs_deepest(&src, &[], segs, false))
            }
        }
    }
}

/// `[package] name` from a Cargo.toml, as code writes it (dashes become underscores).
fn cargo_name(toml: &str) -> Option<String> {
    let mut in_package = false;
    for line in toml.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            in_package = line == "[package]" || line == "[lib]";
            continue;
        }
        if in_package
            && let Some(v) = line.strip_prefix("name").map(str::trim_start).and_then(|l| l.strip_prefix('=')) {
                return Some(v.trim().trim_matches('"').replace('-', "_"));
            }
    }
    None
}

/// Which file imports which, for one commit of one worktree.
struct Graph {
    imports: HashMap<String, Vec<String>>,
    scanned: usize,
    languages: Vec<&'static str>,
    truncated: bool,
}

fn build(root: &Path, files: Vec<String>, changed: &[String]) -> Graph {
    let mut known: HashSet<String> = files.iter().cloned().collect();
    known.extend(changed.iter().cloned());
    let mut sources: Vec<(String, Lang)> = files
        .iter()
        .filter(|f| !f.starts_with("vendor/") && !f.contains("/vendor/") && !f.contains("node_modules/") && !f.ends_with(".min.js") && !f.ends_with(".d.ts"))
        .filter_map(|f| Lang::of(f).map(|l| (f.clone(), l)))
        .collect();
    let truncated = sources.len() > MAX_FILES;
    sources.truncate(MAX_FILES);
    let mut languages: Vec<&'static str> = sources.iter().map(|(_, l)| l.name()).collect::<HashSet<_>>().into_iter().collect();
    languages.sort();

    let resolver = Resolver::new(root, &known);
    let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).min(8);
    let chunk = sources.len().div_ceil(threads).max(1);
    let mut imports: HashMap<String, Vec<String>> = HashMap::new();
    let mut scanned = 0;
    std::thread::scope(|scope| {
        let handles: Vec<_> = sources
            .chunks(chunk)
            .map(|part| {
                let resolver = &resolver;
                scope.spawn(move || {
                    let mut parsers: HashMap<Lang, (Parser, Query)> = HashMap::new();
                    let mut out = Vec::new();
                    for (path, lang) in part {
                        let full = root.join(path);
                        if std::fs::metadata(&full).map(|m| m.len() > MAX_BYTES).unwrap_or(true) {
                            continue;
                        }
                        let Ok(src) = std::fs::read(&full) else { continue };
                        let entry = parsers.entry(*lang).or_insert_with(|| {
                            let mut p = Parser::new();
                            let l = lang.language();
                            p.set_language(&l).expect("grammar matches the tree-sitter version");
                            (p, Query::new(&l, lang.query()).expect("query compiles"))
                        });
                        let (parser, query) = entry;
                        let mut targets: Vec<String> = extract(parser, query, *lang, &src).iter().flat_map(|r| resolver.resolve(path, *lang, r)).filter(|t| t != path).collect();
                        targets.sort();
                        targets.dedup();
                        out.push((path.clone(), targets));
                    }
                    out
                })
            })
            .collect();
        for h in handles {
            if let Ok(part) = h.join() {
                scanned += part.len();
                imports.extend(part.into_iter().filter(|(_, t)| !t.is_empty()));
            }
        }
    });
    Graph { imports, scanned, languages, truncated }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Link {
    from: String,
    to: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Affected {
    path: String,
    /// 1 when it imports a changed file itself, 2 when it imports a file that does.
    hops: u8,
    test: bool,
    /// The files on the map it imports: changed files for hop 1, hop-1 files for hop 2.
    imports: Vec<String>,
    /// The changed files it depends on, directly or not.
    reaches: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlastRadius {
    /// Imports between changed files.
    links: Vec<Link>,
    /// Unchanged files that depend on the changed ones, nearest and most connected first.
    affected: Vec<Affected>,
    /// Affected files over the limit, left out.
    more: usize,
    /// Source files read.
    scanned: usize,
    languages: Vec<&'static str>,
    /// The repository has more source files than the scan reads.
    truncated: bool,
}

fn radius(g: &Graph, changed: &[String]) -> BlastRadius {
    let changed_set: HashSet<&str> = changed.iter().map(String::as_str).collect();
    let mut links = Vec::new();
    let mut importers: HashMap<&str, Vec<&str>> = HashMap::new();
    for (from, tos) in &g.imports {
        for to in tos {
            importers.entry(to.as_str()).or_default().push(from.as_str());
            if changed_set.contains(from.as_str()) && changed_set.contains(to.as_str()) {
                links.push(Link { from: from.clone(), to: to.clone() });
            }
        }
    }
    links.sort_by(|a, b| (&a.from, &a.to).cmp(&(&b.from, &b.to)));

    // Breadth first, backwards along imports, remembering which changed files each file reaches.
    let mut hops: HashMap<&str, u8> = HashMap::new();
    let mut reaches: HashMap<&str, HashSet<&str>> = HashMap::new();
    let mut queue: VecDeque<&str> = VecDeque::new();
    for c in changed {
        hops.insert(c, 0);
        reaches.entry(c).or_default().insert(c);
        queue.push_back(c);
    }
    while let Some(cur) = queue.pop_front() {
        let h = hops[cur];
        if h >= MAX_HOPS {
            continue;
        }
        let from_cur: Vec<&str> = reaches.get(cur).map(|s| s.iter().copied().collect()).unwrap_or_default();
        for &imp in importers.get(cur).map(Vec::as_slice).unwrap_or(&[]) {
            if changed_set.contains(imp) {
                continue;
            }
            let entry = hops.entry(imp).or_insert_with(|| {
                queue.push_back(imp);
                h + 1
            });
            if *entry == h + 1 {
                reaches.entry(imp).or_default().extend(from_cur.iter().copied());
            }
        }
    }

    let mut all: Vec<Affected> = hops
        .iter()
        .filter(|(_, h)| **h > 0)
        .map(|(p, h)| {
            let mut r: Vec<String> = reaches.get(p).map(|s| s.iter().map(|x| x.to_string()).collect()).unwrap_or_default();
            r.sort();
            Affected { path: p.to_string(), hops: *h, test: is_test(p), imports: Vec::new(), reaches: r }
        })
        .collect();
    all.sort_by(|a, b| a.hops.cmp(&b.hops).then(b.reaches.len().cmp(&a.reaches.len())).then(a.path.cmp(&b.path)));
    let more = all.len().saturating_sub(MAX_AFFECTED);
    all.truncate(MAX_AFFECTED);
    let kept: HashMap<String, u8> = all.iter().map(|a| (a.path.clone(), a.hops)).collect();
    for a in &mut all {
        a.imports = g.imports.get(&a.path).map(|t| t.iter().filter(|t| if a.hops == 1 { changed_set.contains(t.as_str()) } else { kept.get(*t) == Some(&(a.hops - 1)) }).cloned().collect()).unwrap_or_default();
    }
    BlastRadius { links, affected: all, more, scanned: g.scanned, languages: g.languages.clone(), truncated: g.truncated }
}

type Cache = Mutex<HashMap<String, (String, Arc<Graph>)>>;

fn cache() -> &'static Cache {
    static CACHE: OnceLock<Cache> = OnceLock::new();
    CACHE.get_or_init(Default::default)
}

/// The files that depend on the PR's changed files, from the imports in its worktree.
#[tauri::command]
pub async fn blast_radius(cwd: String, changed: Vec<String>) -> Result<BlastRadius, String> {
    let root = Path::new(&cwd);
    let head = crate::process::run("git", &["rev-parse", "HEAD"], Some(root)).await?.trim().to_string();
    let hit = cache().lock().ok().and_then(|c| c.get(&cwd).filter(|(h, _)| *h == head).map(|(_, g)| g.clone()));
    let graph = match hit {
        Some(g) => g,
        None => {
            let listed = crate::process::run("git", &["ls-files", "-z"], Some(root)).await?;
            let files: Vec<String> = listed.split('\0').filter(|f| !f.is_empty()).map(str::to_string).collect();
            let (dir, ch) = (cwd.clone(), changed.clone());
            let g = Arc::new(tauri::async_runtime::spawn_blocking(move || build(Path::new(&dir), files, &ch)).await.map_err(|e| e.to_string())?);
            if let Ok(mut c) = cache().lock() {
                c.insert(cwd.clone(), (head, g.clone()));
            }
            g
        }
    };
    Ok(radius(&graph, &changed))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo(files: &[(&str, &str)]) -> tempdir::Dir {
        tempdir::Dir::new(files)
    }

    /// A throwaway folder of files, removed when dropped.
    mod tempdir {
        pub struct Dir(pub std::path::PathBuf);
        impl Dir {
            pub fn new(files: &[(&str, &str)]) -> Dir {
                use std::sync::atomic::{AtomicU32, Ordering};
                static N: AtomicU32 = AtomicU32::new(0);
                let dir = std::env::temp_dir().join(format!("betterlgtm-deps-{}-{}", std::process::id(), N.fetch_add(1, Ordering::SeqCst)));
                for (path, body) in files {
                    let p = dir.join(path);
                    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
                    std::fs::write(p, body).unwrap();
                }
                Dir(dir)
            }
        }
        impl Drop for Dir {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }
    }

    fn graph(files: &[(&str, &str)], changed: &[&str]) -> (BlastRadius, Graph) {
        let d = repo(files);
        let list: Vec<String> = files.iter().map(|(p, _)| p.to_string()).collect();
        let changed: Vec<String> = changed.iter().map(|s| s.to_string()).collect();
        let g = build(&d.0, list, &changed);
        (radius(&g, &changed), g)
    }

    fn deps(g: &Graph, path: &str) -> Vec<String> {
        g.imports.get(path).cloned().unwrap_or_default()
    }

    #[test]
    fn queries_compile() {
        for l in [Lang::Ts, Lang::Tsx, Lang::Py, Lang::Go, Lang::Rs] {
            Query::new(&l.language(), l.query()).unwrap_or_else(|e| panic!("{l:?}: {e}"));
        }
    }

    #[test]
    fn typescript_imports_resolve() {
        let (_, g) = graph(
            &[
                ("tsconfig.json", r#"{ // comment
                    "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*"], }, }, }"#),
                ("src/a.ts", "import { b } from './b.js';\nimport c from '@/lib/c';\nexport * from \"./d\";\nconst e = require('../e');\nconst f = await import('./f');\nimport x from 'react';"),
                ("src/b.ts", ""),
                ("src/lib/c.tsx", ""),
                ("src/d/index.ts", ""),
                ("e.js", ""),
                ("src/f.ts", ""),
            ],
            &[],
        );
        assert_eq!(deps(&g, "src/a.ts"), ["e.js", "src/b.ts", "src/d/index.ts", "src/f.ts", "src/lib/c.tsx"]);
    }

    #[test]
    fn workspace_packages_resolve() {
        let (_, g) = graph(
            &[
                ("packages/ui/package.json", r#"{ "name": "@acme/ui", "main": "dist/index.js" }"#),
                ("packages/ui/src/index.ts", ""),
                ("packages/ui/src/button.tsx", ""),
                ("apps/web/page.tsx", "import { Button } from '@acme/ui';\nimport b from '@acme/ui/button';"),
            ],
            &[],
        );
        assert_eq!(deps(&g, "apps/web/page.tsx"), ["packages/ui/src/button.tsx", "packages/ui/src/index.ts"]);
    }

    #[test]
    fn python_imports_resolve() {
        let (_, g) = graph(
            &[
                ("pyproject.toml", ""),
                ("src/app/__init__.py", ""),
                ("src/app/models.py", ""),
                ("src/app/util/__init__.py", ""),
                ("src/app/util/text.py", ""),
                ("src/app/views.py", "import app.models\nfrom .util import text\nfrom . import models as m\nfrom app.util import helper\nimport os"),
            ],
            &[],
        );
        assert_eq!(deps(&g, "src/app/views.py"), ["src/app/models.py", "src/app/util/__init__.py", "src/app/util/text.py"]);
    }

    #[test]
    fn go_imports_resolve() {
        let (_, g) = graph(
            &[
                ("go.mod", "module example.com/shop\n\ngo 1.22\n"),
                ("cart/cart.go", "package cart"),
                ("cart/cart_test.go", "package cart"),
                ("cmd/main.go", "package main\nimport (\n  \"fmt\"\n  \"example.com/shop/cart\"\n)"),
            ],
            &[],
        );
        assert_eq!(deps(&g, "cmd/main.go"), ["cart/cart.go"]);
    }

    #[test]
    fn rust_paths_resolve() {
        let (_, g) = graph(
            &[
                ("Cargo.toml", "[package]\nname = \"my-app\"\n"),
                ("src/lib.rs", "mod process;\nmod net;\npub use crate::net::{http::Client, Error};"),
                ("src/process.rs", "use super::net;\npub fn run() { crate::net::http::get(); }"),
                ("src/net/mod.rs", "pub mod http;\nuse self::http::Client;"),
                ("src/net/http.rs", "use std::io;"),
                ("tests/it.rs", "use my_app::process::run;"),
            ],
            &[],
        );
        assert_eq!(deps(&g, "src/lib.rs"), ["src/net/http.rs", "src/net/mod.rs"]);
        assert_eq!(deps(&g, "src/process.rs"), ["src/net/http.rs", "src/net/mod.rs"]);
        assert_eq!(deps(&g, "src/net/mod.rs"), ["src/net/http.rs"]);
        assert_eq!(deps(&g, "tests/it.rs"), ["src/process.rs"]);
    }

    #[test]
    fn use_trees_expand() {
        assert_eq!(expand_use("a::{b, c::{d as e, *}, self}"), vec![vec!["a", "b"], vec!["a", "c", "d"], vec!["a"]]);
        assert_eq!(expand_use("crate::x as y"), vec![vec!["crate", "x"]]);
    }

    #[test]
    fn affected_files_go_two_hops_back() {
        let (r, _) = graph(
            &[
                ("src/core.ts", ""),
                ("src/api.ts", "import './core';"),
                ("src/page.tsx", "import './api';"),
                ("src/far.ts", "import './page';"),
                ("src/core.test.ts", "import './core';"),
                ("src/other.ts", "import './api';"),
            ],
            &["src/core.ts", "src/other.ts"],
        );
        let got: Vec<(&str, u8, bool)> = r.affected.iter().map(|a| (a.path.as_str(), a.hops, a.test)).collect();
        assert_eq!(got, [("src/api.ts", 1, false), ("src/core.test.ts", 1, true), ("src/page.tsx", 2, false)]);
        assert_eq!(r.affected[2].imports, ["src/api.ts"]);
        assert_eq!(r.affected[2].reaches, ["src/core.ts"]);
        assert!(r.links.is_empty());
    }

    #[test]
    fn deleted_files_still_have_importers() {
        let (r, _) = graph(&[("a.ts", "import './gone';")], &["gone.ts"]);
        assert_eq!(r.affected.iter().map(|a| a.path.as_str()).collect::<Vec<_>>(), ["a.ts"]);
    }
}

/// `SCAN=<repo> CHANGED=a,b cargo test scan_repo -- --ignored --nocapture` prints the radius for a real repository.
#[cfg(test)]
#[test]
#[ignore]
fn scan_repo() {
    let dir = std::env::var("SCAN").expect("SCAN");
    let changed: Vec<String> = std::env::var("CHANGED").unwrap_or_default().split(',').filter(|s| !s.is_empty()).map(str::to_string).collect();
    // Outside a git repository (FIND=1), every file under the folder.
    let (cmd, args): (&str, &[&str]) = if std::env::var("FIND").is_ok() { ("find", &[".", "-type", "f", "-printf", "%P\\0"]) } else { ("git", &["ls-files", "-z"]) };
    let out = std::process::Command::new(cmd).args(args).current_dir(&dir).output().unwrap();
    let files: Vec<String> = String::from_utf8_lossy(&out.stdout).split('\0').filter(|f| !f.is_empty()).map(str::to_string).collect();
    let t = std::time::Instant::now();
    let g = build(Path::new(&dir), files, &changed);
    println!("scanned {} files ({:?}) in {:?}, {} with imports", g.scanned, g.languages, t.elapsed(), g.imports.len());
    let r = radius(&g, &changed);
    for l in &r.links {
        println!("link {} -> {}", l.from, l.to);
    }
    for a in &r.affected {
        println!("hop {} {}{} imports {:?}", a.hops, a.path, if a.test { " (test)" } else { "" }, a.imports);
    }
    println!("more: {}", r.more);
}
