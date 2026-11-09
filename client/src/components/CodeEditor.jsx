// Notepad++-style editor: Monaco bundled locally (works offline), Ctrl+S to save, status bar.
import { useEffect, useRef, useState } from "react";
import * as monaco from "monaco-editor";
import Editor, { loader } from "@monaco-editor/react";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import { api } from "../api.js";
import { baseName } from "../files.js";

self.MonacoEnvironment = {
  getWorker(_, label) {
    if (label === "json") return new jsonWorker();
    if (["css", "scss", "less"].includes(label)) return new cssWorker();
    if (["html", "handlebars", "razor"].includes(label)) return new htmlWorker();
    if (["typescript", "javascript"].includes(label)) return new tsWorker();
    return new editorWorker();
  },
};
loader.config({ monaco });

const EXTRA = { dockerfile: "dockerfile", makefile: "plaintext", ".env": "ini", ".gitignore": "plaintext", ".conf": "ini", ".toml": "ini", ".log": "plaintext", ".ps1": "powershell", ".sh": "shell", ".bash": "shell", ".zsh": "shell", ".tf": "hcl", ".vue": "html", ".jsonc": "json" };

function languageFor(path) {
  const name = baseName(path).toLowerCase();
  if (EXTRA[name]) return EXTRA[name];
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
  if (EXTRA[ext]) return EXTRA[ext];
  for (const lang of monaco.languages.getLanguages()) {
    if (lang.extensions?.includes(ext) || lang.filenames?.map((f) => f.toLowerCase()).includes(name)) return lang.id;
  }
  return "plaintext";
}

const LANGS = monaco.languages.getLanguages().map((l) => ({ id: l.id, label: l.aliases?.[0] || l.id })).sort((a, b) => a.label.localeCompare(b.label));

function loadPrefs() {
  try { return { wrap: false, minimap: true, whitespace: false, fontSize: 14, ...JSON.parse(localStorage.getItem("codePrefs") || "{}") }; }
  catch { return { wrap: false, minimap: true, whitespace: false, fontSize: 14 }; }
}

export default function CodeEditor({ path, theme, active, line, lineAt, onDirty, notify }) {
  const [content, setContent] = useState(null);
  const [language, setLanguage] = useState(() => languageFor(path));
  const [cursor, setCursor] = useState({ ln: 1, col: 1, sel: 0 });
  const [eol, setEol] = useState("LF");
  const [prefs, setPrefs] = useState(loadPrefs);
  const [dirty, setDirtyState] = useState(false);
  const [lines, setLines] = useState(0);
  const editorRef = useRef(null);
  const saved = useRef(null);
  const pathRef = useRef(path);
  const cb = useRef({});
  pathRef.current = path;
  cb.current = { onDirty, notify };

  useEffect(() => { setLanguage(languageFor(path)); }, [path]);
  useEffect(() => { try { localStorage.setItem("codePrefs", JSON.stringify(prefs)); } catch {} }, [prefs]);

  const markDirty = (d) => { setDirtyState(d); cb.current.onDirty(d); };

  // Load on open, and reload on re-activation if the file changed on disk and we're clean.
  useEffect(() => {
    if (!active) return;
    if (editorRef.current && editorRef.current.getValue() !== saved.current) return;
    let cancelled = false;
    api.read(pathRef.current).then(
      (f) => {
        if (cancelled || f.content === saved.current) return;
        saved.current = f.content;
        setEol(f.content.includes("\r\n") ? "CRLF" : "LF");
        if (editorRef.current) editorRef.current.setValue(f.content);
        else setContent(f.content);
      },
      (e) => { if (!cancelled && saved.current === null) cb.current.notify(`Could not open: ${e.message}`); }
    );
    return () => { cancelled = true; };
  }, [active]);

  const save = async () => {
    const ed = editorRef.current;
    if (!ed) return;
    const value = ed.getValue();
    try {
      await api.write(pathRef.current, value);
      saved.current = value;
      markDirty(ed.getValue() !== value);
    } catch (e) {
      cb.current.notify(`Save failed: ${e.message}`);
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    if (active && editorRef.current) {
      editorRef.current.focus();
      editorRef.current.layout();
    }
  }, [active]);

  useEffect(() => {
    const ed = editorRef.current;
    if (ed && line) {
      ed.revealLineInCenter(line);
      ed.setPosition({ lineNumber: line, column: 1 });
      ed.focus();
    }
  }, [line, lineAt, content]);

  const onMount = (ed) => {
    editorRef.current = ed;
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveRef.current());
    ed.onDidChangeCursorSelection((e) => {
      const model = ed.getModel();
      setCursor({ ln: e.selection.positionLineNumber, col: e.selection.positionColumn, sel: model ? model.getValueInRange(e.selection).length : 0 });
    });
    setLines(ed.getModel()?.getLineCount() ?? 0);
    ed.onDidChangeModelContent(() => {
      setLines(ed.getModel()?.getLineCount() ?? 0);
      const d = ed.getValue() !== saved.current;
      setDirtyState((prev) => { if (prev !== d) cb.current.onDirty(d); return d; });
    });
    if (line) { ed.revealLineInCenter(line); ed.setPosition({ lineNumber: line, column: 1 }); }
    ed.focus();
  };

  const toggleEol = () => {
    const model = editorRef.current?.getModel();
    if (!model) return;
    const next = eol === "LF" ? "CRLF" : "LF";
    model.pushEOL(next === "LF" ? monaco.editor.EndOfLineSequence.LF : monaco.editor.EndOfLineSequence.CRLF);
    setEol(next);
  };

  const run = (id) => { const ed = editorRef.current; ed?.focus(); ed?.getAction(id)?.run(); };

  if (content === null) return <div className="loading">Loading…</div>;

  return (
    <div className="code-wrap">
      <div className="code-toolbar">
        <button onClick={() => save()} disabled={!dirty} title="Save (Ctrl+S)">💾 Save</button>
        <span className="sep" />
        <button onClick={() => run("actions.find")} title="Find (Ctrl+F)">🔍 Find</button>
        <button onClick={() => run("editor.action.startFindReplaceAction")} title="Replace (Ctrl+H)">⇄ Replace</button>
        <button onClick={() => run("editor.action.gotoLine")} title="Go to line (Ctrl+G)">↧ Line</button>
        <button onClick={() => run("editor.action.formatDocument")} title="Format document (Shift+Alt+F)">✨ Format</button>
        <button onClick={() => run("editor.foldAll")} title="Fold all">⊟</button>
        <button onClick={() => run("editor.unfoldAll")} title="Unfold all">⊞</button>
        <span className="sep" />
        <label><input type="checkbox" checked={prefs.wrap} onChange={(e) => setPrefs({ ...prefs, wrap: e.target.checked })} /> Wrap</label>
        <label><input type="checkbox" checked={prefs.whitespace} onChange={(e) => setPrefs({ ...prefs, whitespace: e.target.checked })} /> ¶ Show all</label>
        <label><input type="checkbox" checked={prefs.minimap} onChange={(e) => setPrefs({ ...prefs, minimap: e.target.checked })} /> Map</label>
        <span className="sep" />
        <button onClick={() => setPrefs({ ...prefs, fontSize: Math.max(9, prefs.fontSize - 1) })} title="Zoom out">A−</button>
        <button onClick={() => setPrefs({ ...prefs, fontSize: Math.min(32, prefs.fontSize + 1) })} title="Zoom in">A+</button>
      </div>
      <div className="code-editor">
        <Editor
          defaultValue={content}
          language={language}
          theme={theme === "dark" ? "vs-dark" : "vs"}
          onMount={onMount}
          options={{
            fontSize: prefs.fontSize,
            fontFamily: "'Cascadia Code', Consolas, 'Courier New', monospace",
            wordWrap: prefs.wrap ? "on" : "off",
            renderWhitespace: prefs.whitespace ? "all" : "selection",
            renderControlCharacters: prefs.whitespace,
            minimap: { enabled: prefs.minimap },
            automaticLayout: true,
            smoothScrolling: true,
            bracketPairColorization: { enabled: true },
            guides: { bracketPairs: true, indentation: true },
            multiCursorModifier: "alt",
            columnSelection: false,
            scrollBeyondLastLine: false,
            folding: true,
            stickyScroll: { enabled: true },
          }}
        />
      </div>
      <div className="statusbar">
        <span>{dirty ? "● Modified" : "Saved"}</span>
        <span>{lines} lines</span>
        <span>Ln {cursor.ln}, Col {cursor.col}{cursor.sel ? ` (${cursor.sel} sel)` : ""}</span>
        <span className="grow" />
        <button onClick={toggleEol} title="Toggle line endings">{eol === "LF" ? "Unix (LF)" : "Windows (CR LF)"}</button>
        <span>UTF-8</span>
        <select value={language} onChange={(e) => setLanguage(e.target.value)} title="Language">
          {LANGS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
        </select>
      </div>
    </div>
  );
}
