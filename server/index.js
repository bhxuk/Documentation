// Documentation server: serves the web app and a small file API over DATA_DIR.
// Everything you create lives as plain files in DATA_DIR:
//   *.md          -> block-editor pages
//   *.excalidraw  -> whiteboards (with a *.excalidraw.svg preview next to them)
//   anything else -> code / text files

const express = require("express");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const archiver = require("archiver");

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, "..", "data"));
const CLIENT_DIR = path.resolve(process.env.CLIENT_DIR || path.join(__dirname, "..", "client", "dist"));
const TRASH = ".trash";
const ASSETS = "_assets";
const MAX_SEARCH_BYTES = 2 * 1024 * 1024;
const VERSION = (() => {
  for (const p of [path.join(__dirname, "..", "VERSION"), path.join(__dirname, "VERSION")]) {
    try { return fs.readFileSync(p, "utf8").trim(); } catch {}
  }
  return "dev";
})();

fs.mkdirSync(DATA_DIR, { recursive: true });

// Resolve a client-supplied relative path and refuse anything outside DATA_DIR.
function safe(rel) {
  if (typeof rel !== "string") throw httpError(400, "path required");
  const clean = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  const abs = path.resolve(DATA_DIR, clean);
  if (abs !== DATA_DIR && !abs.startsWith(DATA_DIR + path.sep)) throw httpError(400, "path outside data dir");
  return abs;
}

function rel(abs) {
  return path.relative(DATA_DIR, abs).split(path.sep).join("/");
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

const hidden = (name) => name.startsWith(".") || name.endsWith(".excalidraw.svg");

async function readTree(dir) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    if (hidden(e.name)) continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push({ name: e.name, path: rel(abs), type: "folder", children: await readTree(abs) });
    } else if (e.isFile()) {
      out.push({ name: e.name, path: rel(abs), type: "file" });
    }
  }
  out.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.type === "folder" ? -1 : 1));
  return out;
}

async function* walkFiles(dir) {
  for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
    if (hidden(e.name)) continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) yield* walkFiles(abs);
    else if (e.isFile()) yield abs;
  }
}

async function exists(p) {
  try { await fsp.access(p); return true; } catch { return false; }
}

// Pick a free name like "Untitled 2.md" if the target already exists.
async function uniquePath(abs) {
  if (!(await exists(abs))) return abs;
  const dir = path.dirname(abs);
  const base = path.basename(abs);
  const m = base.match(/^(.*?)((?:\.excalidraw)?(?:\.[^.]+)?)$/);
  const stem = m[1] || base;
  const ext = m[2] || "";
  for (let i = 2; ; i++) {
    const cand = path.join(dir, `${stem} ${i}${ext}`);
    if (!(await exists(cand))) return cand;
  }
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "50mb" }));

const api = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

api.get("/health", (req, res) => res.json({ ok: true, version: VERSION }));

api.get("/tree", wrap(async (req, res) => {
  res.json(await readTree(DATA_DIR));
}));

api.get("/file", wrap(async (req, res) => {
  const abs = safe(req.query.path);
  const stat = await fsp.stat(abs).catch(() => null);
  if (!stat || !stat.isFile()) throw httpError(404, "not found");
  res.json({ path: rel(abs), content: await fsp.readFile(abs, "utf8"), mtime: stat.mtimeMs, size: stat.size });
}));

api.put("/file", wrap(async (req, res) => {
  const abs = safe(req.query.path);
  if (typeof req.body.content !== "string") throw httpError(400, "content must be a string");
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, req.body.content, "utf8");
  const stat = await fsp.stat(abs);
  res.json({ path: rel(abs), mtime: stat.mtimeMs, size: stat.size });
}));

api.post("/create", wrap(async (req, res) => {
  const { path: p, type, content = "" } = req.body || {};
  const abs = await uniquePath(safe(p));
  if (type === "folder") {
    await fsp.mkdir(abs, { recursive: true });
  } else {
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, content, "utf8");
  }
  res.json({ path: rel(abs), type: type === "folder" ? "folder" : "file" });
}));

api.post("/rename", wrap(async (req, res) => {
  const from = safe(req.body.from);
  const to = safe(req.body.to);
  if (from === DATA_DIR) throw httpError(400, "cannot rename root");
  if (await exists(to)) throw httpError(409, "a file with that name already exists");
  await fsp.mkdir(path.dirname(to), { recursive: true });
  await fsp.rename(from, to);
  // Keep a whiteboard's preview alongside it.
  if (from.endsWith(".excalidraw") && (await exists(from + ".svg"))) {
    await fsp.rename(from + ".svg", to.endsWith(".excalidraw") ? to + ".svg" : to + ".excalidraw.svg").catch(() => {});
  }
  res.json({ path: rel(to) });
}));

// Deleting moves things into DATA_DIR/.trash so nothing is lost by accident.
api.delete("/file", wrap(async (req, res) => {
  const abs = safe(req.query.path);
  if (abs === DATA_DIR) throw httpError(400, "cannot delete root");
  if (!(await exists(abs))) throw httpError(404, "not found");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = path.join(DATA_DIR, TRASH, `${stamp}__${rel(abs).replace(/\//g, "__")}`);
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await fsp.rename(abs, dest);
  if (await exists(abs + ".svg")) await fsp.rename(abs + ".svg", dest + ".svg").catch(() => {});
  res.json({ ok: true });
}));

api.post("/upload", express.raw({ type: "*/*", limit: "100mb" }), wrap(async (req, res) => {
  const name = String(req.query.name || "file").replace(/[^\w.\- ]+/g, "_").slice(-120) || "file";
  const abs = await uniquePath(path.join(DATA_DIR, ASSETS, name));
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, req.body);
  res.json({ path: rel(abs), url: "/files/" + rel(abs).split("/").map(encodeURIComponent).join("/") });
}));

// Full-text search across names and contents. Whiteboards are searched by their text elements.
api.get("/search", wrap(async (req, res) => {
  const q = String(req.query.q || "").trim().toLowerCase();
  if (!q) return res.json([]);
  const results = [];
  for await (const abs of walkFiles(DATA_DIR)) {
    if (results.length >= 200) break;
    const p = rel(abs);
    const nameHit = path.basename(p).toLowerCase().includes(q);
    const matches = [];
    const stat = await fsp.stat(abs);
    if (stat.size <= MAX_SEARCH_BYTES && !p.startsWith(ASSETS + "/")) {
      let text = await fsp.readFile(abs, "utf8");
      if (text.includes("\u0000")) text = "";
      if (p.endsWith(".excalidraw")) {
        try {
          text = (JSON.parse(text).elements || []).filter((e) => !e.isDeleted && e.text).map((e) => e.text).join("\n");
        } catch { text = ""; }
      }
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length && matches.length < 5; i++) {
        if (lines[i].toLowerCase().includes(q)) matches.push({ line: i + 1, text: lines[i].trim().slice(0, 200) });
      }
    }
    if (nameHit || matches.length) results.push({ path: p, nameHit, matches });
  }
  results.sort((a, b) => Number(b.nameHit) - Number(a.nameHit));
  res.json(results);
}));

api.get("/export.zip", (req, res, next) => {
  res.attachment(`documentation-${new Date().toISOString().slice(0, 10)}.zip`);
  const zip = archiver("zip", { zlib: { level: 9 } });
  zip.on("error", next);
  zip.pipe(res);
  zip.glob("**/*", { cwd: DATA_DIR, dot: false, ignore: [TRASH + "/**"] });
  zip.finalize();
});

app.use("/api", api);
app.use("/files", express.static(DATA_DIR, { dotfiles: "deny", index: false }));
app.use(express.static(CLIENT_DIR, { index: "index.html" }));
app.get(/^(?!\/(api|files)\/).*/, (req, res, next) => {
  const index = path.join(CLIENT_DIR, "index.html");
  fs.access(index, (err) => (err ? next() : res.sendFile(index)));
});

app.use((err, req, res, next) => {
  const status = err.status || (err.code === "ENOENT" ? 404 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message });
});

// First run: give the user something to look at.
(async () => {
  const entries = (await fsp.readdir(DATA_DIR)).filter((n) => !n.startsWith("."));
  if (entries.length === 0) {
    await fsp.writeFile(
      path.join(DATA_DIR, "Welcome.md"),
      [
        "Everything here is saved as plain files in your data folder.",
        "",
        "* Type `/` in a page for headings, lists, to-dos, tables, code blocks and whiteboards.",
        "* Use the **+** buttons in the sidebar to create pages, whiteboards, code files and folders.",
        "* `Ctrl+P` quick-opens any file, `Ctrl+Shift+F` searches inside everything.",
        "* Code files open in a Notepad++-style editor: tabs, syntax highlighting, find & replace, `Ctrl+S` to save.",
        "",
      ].join("\n")
    );
  }
})().catch((e) => console.error("seed failed", e));

app.listen(PORT, () => console.log(`Documentation ${VERSION} on :${PORT}, data in ${DATA_DIR}`));
