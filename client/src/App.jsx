import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { api, fileUrl } from "./api.js";
import { kindOf, displayName, icon, join, baseName, EMPTY_WHITEBOARD, EMPTY_SVG } from "./files.js";
import Sidebar from "./components/Sidebar.jsx";
import SearchDialog from "./components/SearchDialog.jsx";

const PageEditor = lazy(() => import("./components/PageEditor.jsx"));
const CodeEditor = lazy(() => import("./components/CodeEditor.jsx"));
const Whiteboard = lazy(() => import("./components/Whiteboard.jsx"));

const NEW_ITEMS = {
  page: { name: "Untitled.md", content: "" },
  whiteboard: { name: "Untitled.excalidraw", content: EMPTY_WHITEBOARD },
  file: { name: "untitled.txt", content: "" },
  folder: { name: "New folder", type: "folder" },
};

let nextId = 1;

function loadSession() {
  try {
    const s = JSON.parse(localStorage.getItem("session") || "{}");
    const tabs = (s.tabs || []).map((t) => ({ id: nextId++, path: t.path, mode: t.mode, dirty: false }));
    const active = tabs[s.activeIndex]?.id ?? tabs[0]?.id ?? null;
    return { tabs, active };
  } catch {
    return { tabs: [], active: null };
  }
}

export default function App() {
  const [tree, setTree] = useState([]);
  const [session] = useState(loadSession);
  const [tabs, setTabs] = useState(session.tabs);
  const [active, setActive] = useState(session.active);
  const [theme, setTheme] = useState(document.documentElement.dataset.theme || "light");
  const [search, setSearch] = useState(null); // null | "files" | "text"
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [renaming, setRenaming] = useState(null);
  const [toast, setToast] = useState(null);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  const notify = useCallback((msg) => {
    setToast(msg);
    clearTimeout(notify.t);
    notify.t = setTimeout(() => setToast(null), 3500);
  }, []);

  const refresh = useCallback(() => api.tree().then(setTree).catch((e) => notify(e.message)), [notify]);
  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("theme", theme); } catch {}
  }, [theme]);

  useEffect(() => {
    try {
      localStorage.setItem("session", JSON.stringify({
        tabs: tabs.map((t) => ({ path: t.path, mode: t.mode })),
        activeIndex: Math.max(0, tabs.findIndex((t) => t.id === active)),
      }));
    } catch {}
    const tab = tabs.find((t) => t.id === active);
    document.title = tab ? `${displayName(tab.path)} · Documentation` : "Documentation";
  }, [tabs, active]);

  const openFile = useCallback((path, opts = {}) => {
    const mode = opts.mode || kindOf(path);
    const existing = tabsRef.current.find((t) => t.path === path && t.mode === mode);
    if (existing) {
      if (opts.line) setTabs((ts) => ts.map((t) => (t.id === existing.id ? { ...t, line: opts.line, lineAt: Date.now() } : t)));
      setActive(existing.id);
      return;
    }
    const tab = { id: nextId++, path, mode, dirty: false, line: opts.line, lineAt: Date.now() };
    setTabs((ts) => [...ts, tab]);
    setActive(tab.id);
  }, []);

  const closeTab = useCallback((id) => {
    const tab = tabsRef.current.find((t) => t.id === id);
    if (tab?.dirty && !confirm(`${baseName(tab.path)} has unsaved changes. Close anyway?`)) return;
    setTabs((ts) => {
      const i = ts.findIndex((t) => t.id === id);
      const next = ts.filter((t) => t.id !== id);
      setActive((a) => (a === id ? next[Math.min(i, next.length - 1)]?.id ?? null : a));
      return next;
    });
  }, []);

  const setDirty = useCallback((id, dirty) => {
    setTabs((ts) => (ts.some((t) => t.id === id && t.dirty !== dirty) ? ts.map((t) => (t.id === id ? { ...t, dirty } : t)) : ts));
  }, []);

  const create = useCallback(async (dir, kind) => {
    const item = NEW_ITEMS[kind];
    try {
      const res = await api.create(join(dir, item.name), item.type || "file", item.content);
      if (kind === "whiteboard") await api.write(res.path + ".svg", EMPTY_SVG);
      await refresh();
      if (kind === "folder" || kind === "file") setRenaming(res.path);
      if (kind !== "folder") openFile(res.path);
      return res.path;
    } catch (e) {
      notify(e.message);
    }
  }, [refresh, openFile, notify]);

  const rename = useCallback(async (from, to) => {
    if (!to || from === to) return from;
    try {
      const res = await api.rename(from, to);
      setTabs((ts) => ts.map((t) =>
        t.path === from ? { ...t, path: res.path }
        : t.path.startsWith(from + "/") ? { ...t, path: res.path + t.path.slice(from.length) }
        : t));
      await refresh();
      return res.path;
    } catch (e) {
      notify(e.message);
      return from;
    }
  }, [refresh, notify]);

  const remove = useCallback(async (path) => {
    if (!confirm(`Move "${baseName(path)}" to trash?`)) return;
    try {
      await api.remove(path);
      tabsRef.current.filter((t) => t.path === path || t.path.startsWith(path + "/")).forEach((t) => {
        setTabs((ts) => ts.filter((x) => x.id !== t.id));
        setActive((a) => (a === t.id ? null : a));
      });
      await refresh();
      notify(`Moved ${baseName(path)} to .trash`);
    } catch (e) {
      notify(e.message);
    }
  }, [refresh, notify]);

  // Global shortcuts.
  useEffect(() => {
    const onKey = (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.shiftKey && e.key.toLowerCase() === "f") { e.preventDefault(); setSearch("text"); }
      else if (mod && !e.shiftKey && (e.key === "p" || e.key === "k")) { e.preventDefault(); setSearch("files"); }
      else if (mod && e.key === "\\") { e.preventDefault(); setSidebarOpen((o) => !o); }
      else if (e.altKey && e.key.toLowerCase() === "w" && active) { e.preventDefault(); closeTab(active); }
      else if (mod && e.key === "Tab" && tabsRef.current.length > 1) {
        e.preventDefault();
        const ts = tabsRef.current;
        const i = ts.findIndex((t) => t.id === active);
        setActive(ts[(i + (e.shiftKey ? -1 : 1) + ts.length) % ts.length].id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, closeTab]);

  useEffect(() => {
    const warn = (e) => { if (tabsRef.current.some((t) => t.dirty)) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const activeTab = tabs.find((t) => t.id === active);

  return (
    <div className={`app ${sidebarOpen ? "" : "sidebar-hidden"}`}>
      {sidebarOpen && (
        <Sidebar
          tree={tree}
          activePath={activeTab?.path}
          renaming={renaming}
          setRenaming={setRenaming}
          onOpen={openFile}
          onCreate={create}
          onRename={rename}
          onDelete={remove}
          onSearch={setSearch}
          theme={theme}
          onTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
          onCollapse={() => setSidebarOpen(false)}
        />
      )}
      <main className="main">
        <div className="tabbar" onDoubleClick={(e) => e.target === e.currentTarget && create("", "file")}>
          {!sidebarOpen && (
            <button className="icon-btn tab-sidebar" title="Show sidebar (Ctrl+\)" onClick={() => setSidebarOpen(true)}>☰</button>
          )}
          {tabs.map((t) => (
            <div
              key={t.id}
              className={`tab ${t.id === active ? "active" : ""} ${t.dirty ? "dirty" : ""}`}
              title={t.path}
              onClick={() => setActive(t.id)}
              onMouseDown={(e) => e.button === 1 && (e.preventDefault(), closeTab(t.id))}
            >
              <span className="tab-icon">{icon(t.mode)}</span>
              <span className="tab-name">{t.mode === "code" ? baseName(t.path) : displayName(t.path)}</span>
              <button className="tab-close" onClick={(e) => { e.stopPropagation(); closeTab(t.id); }} title="Close (Alt+W)">
                <span className="dot">●</span><span className="x">×</span>
              </button>
            </div>
          ))}
        </div>
        <div className="editors">
          {tabs.length === 0 && <Empty onCreate={create} onSearch={setSearch} />}
          <Suspense fallback={<div className="loading">Loading editor…</div>}>
            {tabs.map((t) => (
              <div key={t.id} className="editor-host" hidden={t.id !== active}>
                {t.mode === "page" && (
                  <PageEditor
                    path={t.path}
                    theme={theme}
                    active={t.id === active}
                    onDirty={(d) => setDirty(t.id, d)}
                    onRename={rename}
                    onOpen={openFile}
                    onCreateWhiteboard={async (dir) => create(dir, "whiteboard")}
                    notify={notify}
                  />
                )}
                {t.mode === "code" && (
                  <CodeEditor
                    path={t.path}
                    theme={theme}
                    active={t.id === active}
                    line={t.line}
                    lineAt={t.lineAt}
                    onDirty={(d) => setDirty(t.id, d)}
                    notify={notify}
                  />
                )}
                {t.mode === "whiteboard" && (
                  <Whiteboard path={t.path} theme={theme} active={t.id === active} onDirty={(d) => setDirty(t.id, d)} notify={notify} />
                )}
                {t.mode === "image" && (
                  <div className="image-view"><img src={fileUrl(t.path)} alt={t.path} /></div>
                )}
              </div>
            ))}
          </Suspense>
        </div>
      </main>
      {search && (
        <SearchDialog
          mode={search}
          setMode={setSearch}
          tree={tree}
          onClose={() => setSearch(null)}
          onOpen={(path, opts) => { setSearch(null); openFile(path, opts); }}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function Empty({ onCreate, onSearch }) {
  return (
    <div className="empty">
      <h1>Documentation</h1>
      <p>Pages, code and whiteboards — all saved as plain files.</p>
      <div className="empty-actions">
        <button onClick={() => onCreate("", "page")}>📄 New page</button>
        <button onClick={() => onCreate("", "whiteboard")}>🎨 New whiteboard</button>
        <button onClick={() => onCreate("", "file")}>📝 New file</button>
        <button onClick={() => onSearch("files")}>🔎 Open… <kbd>Ctrl P</kbd></button>
      </div>
      <dl className="shortcuts">
        <dt><kbd>Ctrl P</kbd></dt><dd>Quick open</dd>
        <dt><kbd>Ctrl Shift F</kbd></dt><dd>Search in all files</dd>
        <dt><kbd>Ctrl S</kbd></dt><dd>Save code file</dd>
        <dt><kbd>Ctrl Tab</kbd></dt><dd>Next tab</dd>
        <dt><kbd>Alt W</kbd></dt><dd>Close tab</dd>
        <dt><kbd>Ctrl \</kbd></dt><dd>Toggle sidebar</dd>
        <dt><kbd>/</kbd></dt><dd>Block menu in pages</dd>
      </dl>
    </div>
  );
}
