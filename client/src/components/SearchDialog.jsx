// Ctrl+P quick open (file names) and Ctrl+Shift+F full-text search.
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import { flatten, kindOf, icon, displayName } from "../files.js";

function score(path, q) {
  const p = path.toLowerCase();
  const name = p.split("/").pop();
  if (name.startsWith(q)) return 3;
  if (name.includes(q)) return 2;
  if (p.includes(q)) return 1;
  // Loose subsequence match, like most quick-open boxes.
  let i = 0;
  for (const ch of p) if (ch === q[i]) i++;
  return i === q.length ? 0.5 : 0;
}

export default function SearchDialog({ mode, setMode, tree, onClose, onOpen }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const files = useMemo(() => flatten(tree), [tree]);

  useEffect(() => { inputRef.current?.focus(); setSel(0); }, [mode]);

  useEffect(() => {
    const q = query.trim().toLowerCase();
    if (mode === "files") {
      const list = q
        ? files.map((p) => ({ path: p, s: score(p, q) })).filter((r) => r.s > 0).sort((a, b) => b.s - a.s || a.path.length - b.path.length)
        : files.map((p) => ({ path: p }));
      setResults(list.slice(0, 50).map((r) => ({ path: r.path })));
      setSel(0);
      return;
    }
    if (!q) { setResults([]); return; }
    setBusy(true);
    const t = setTimeout(() => {
      api.search(q).then((rs) => {
        setResults(rs.flatMap((r) => (r.matches.length ? r.matches.map((m) => ({ path: r.path, line: m.line, text: m.text })) : [{ path: r.path }])).slice(0, 200));
        setSel(0);
      }).finally(() => setBusy(false));
    }, 200);
    return () => clearTimeout(t);
  }, [query, mode, files]);

  useEffect(() => {
    listRef.current?.children[sel]?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const choose = (r) => {
    if (!r) return;
    const kind = kindOf(r.path);
    // Jump to the matching line for code; pages/whiteboards just open.
    onOpen(r.path, r.line && kind === "code" ? { line: r.line } : {});
  };

  const highlight = (text) => {
    const q = query.trim();
    const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
    if (i < 0) return text;
    return <>{text.slice(0, i)}<mark>{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>;
  };

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog">
        <div className="dialog-tabs">
          <button className={mode === "files" ? "on" : ""} onClick={() => setMode("files")}>Files <kbd>Ctrl P</kbd></button>
          <button className={mode === "text" ? "on" : ""} onClick={() => setMode("text")}>Search in all <kbd>Ctrl Shift F</kbd></button>
        </div>
        <input
          ref={inputRef}
          className="dialog-input"
          placeholder={mode === "files" ? "Type a file name…" : "Search text in pages, files and whiteboards…"}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            else if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
            else if (e.key === "Enter") choose(results[sel]);
          }}
        />
        <div className="results" ref={listRef}>
          {results.map((r, i) => (
            <div key={r.path + ":" + (r.line || 0) + ":" + i} className={`result ${i === sel ? "sel" : ""}`} onMouseEnter={() => setSel(i)} onClick={() => choose(r)}>
              <span>{icon(kindOf(r.path))}</span>
              <div className="result-body">
                <div className="result-name">{highlight(kindOf(r.path) === "code" ? r.path.split("/").pop() : displayName(r.path))}<span className="result-path">{r.path}{r.line ? `:${r.line}` : ""}</span></div>
                {r.text && <div className="result-text">{highlight(r.text)}</div>}
              </div>
            </div>
          ))}
          {!results.length && <div className="result muted">{busy ? "Searching…" : query ? "No matches" : mode === "files" ? "No files yet" : "Type to search"}</div>}
        </div>
      </div>
    </div>
  );
}
