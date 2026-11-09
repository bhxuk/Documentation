import { useEffect, useRef, useState } from "react";
import { kindOf, displayName, icon, dirName, join, baseName, withSuffix } from "../files.js";
import { fileUrl } from "../api.js";

function loadOpen() {
  try { return new Set(JSON.parse(localStorage.getItem("openFolders") || "[]")); } catch { return new Set(); }
}

export default function Sidebar({ tree, activePath, renaming, setRenaming, onOpen, onCreate, onRename, onDelete, onSearch, theme, onTheme, onCollapse }) {
  const [open, setOpen] = useState(loadOpen);
  const [menu, setMenu] = useState(null); // { x, y, node }
  const [dropTarget, setDropTarget] = useState(null);
  const [selectedDir, setSelectedDir] = useState("");

  useEffect(() => {
    try { localStorage.setItem("openFolders", JSON.stringify([...open])); } catch {}
  }, [open]);

  // Reveal the active file's folders.
  useEffect(() => {
    if (!activePath) return;
    const parts = activePath.split("/").slice(0, -1);
    if (!parts.length) return;
    setOpen((o) => {
      const n = new Set(o);
      parts.forEach((_, i) => n.add(parts.slice(0, i + 1).join("/")));
      return n.size === o.size ? o : n;
    });
  }, [activePath]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("blur", close);
    return () => { window.removeEventListener("click", close); window.removeEventListener("blur", close); };
  }, [menu]);

  const toggle = (path) => setOpen((o) => { const n = new Set(o); n.has(path) ? n.delete(path) : n.add(path); return n; });

  const createIn = async (dir, kind) => {
    if (dir) setOpen((o) => new Set(o).add(dir));
    await onCreate(dir, kind);
  };

  const move = async (from, toDir) => {
    if (from === toDir || toDir.startsWith(from + "/") || dirName(from) === toDir) return;
    await onRename(from, join(toDir, baseName(from)));
    if (toDir) setOpen((o) => new Set(o).add(toDir));
  };

  const dropProps = (dir) => ({
    onDragOver: (e) => { if (e.dataTransfer.types.includes("text/x-doc-path")) { e.preventDefault(); e.stopPropagation(); setDropTarget(dir); } },
    onDragLeave: () => setDropTarget((d) => (d === dir ? null : d)),
    onDrop: (e) => {
      e.preventDefault(); e.stopPropagation(); setDropTarget(null);
      const from = e.dataTransfer.getData("text/x-doc-path");
      if (from) move(from, dir);
    },
  });

  const renderNode = (node, depth) => {
    const isFolder = node.type === "folder";
    const kind = isFolder ? "folder" : kindOf(node.path);
    const isOpen = open.has(node.path);
    return (
      <div key={node.path}>
        <div
          className={`node ${activePath === node.path ? "active" : ""} ${dropTarget === node.path ? "drop" : ""}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          draggable={renaming !== node.path}
          onDragStart={(e) => { e.dataTransfer.setData("text/x-doc-path", node.path); e.dataTransfer.effectAllowed = "move"; }}
          {...(isFolder ? dropProps(node.path) : {})}
          onClick={() => {
            if (isFolder) { toggle(node.path); setSelectedDir(node.path); }
            else { onOpen(node.path); setSelectedDir(dirName(node.path)); }
          }}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY, node }); }}
          title={node.path}
        >
          <span className="caret">{isFolder ? (isOpen ? "▾" : "▸") : ""}</span>
          <span className="node-icon">{icon(kind, isOpen)}</span>
          {renaming === node.path ? (
            <RenameInput
              initial={isFolder || kind === "code" || kind === "image" ? node.name : displayName(node.path)}
              onDone={async (value) => {
                setRenaming(null);
                if (value == null) return;
                const name = isFolder || kind === "code" || kind === "image" ? value : withSuffix(node.path, value);
                await onRename(node.path, join(dirName(node.path), name));
              }}
            />
          ) : (
            <span className="node-name">{kind === "code" || kind === "image" || isFolder ? node.name : displayName(node.path)}</span>
          )}
          {isFolder && (
            <span className="node-actions">
              <button title="New page in folder" onClick={(e) => { e.stopPropagation(); createIn(node.path, "page"); }}>+</button>
            </span>
          )}
        </div>
        {isFolder && isOpen && (
          <div>{node.children.length ? node.children.map((c) => renderNode(c, depth + 1)) : <div className="node empty-folder" style={{ paddingLeft: 22 + (depth + 1) * 14 }}>Empty</div>}</div>
        )}
      </div>
    );
  };

  const m = menu?.node;
  const mDir = m ? (m.type === "folder" ? m.path : dirName(m.path)) : selectedDir;

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <span className="brand">📚 Documentation</span>
        <button className="icon-btn" title={theme === "dark" ? "Light mode" : "Dark mode"} onClick={onTheme}>{theme === "dark" ? "☀️" : "🌙"}</button>
        <button className="icon-btn" title="Hide sidebar (Ctrl+\)" onClick={onCollapse}>«</button>
      </div>
      <button className="search-btn" onClick={() => onSearch("files")}>🔎 Search <kbd>Ctrl P</kbd></button>
      <div className="new-row">
        <button title="New page" onClick={() => createIn(selectedDir, "page")}>📄 Page</button>
        <button title="New whiteboard" onClick={() => createIn(selectedDir, "whiteboard")}>🎨 Board</button>
        <button title="New code/text file" onClick={() => createIn(selectedDir, "file")}>📝 File</button>
        <button title="New folder" onClick={() => createIn(selectedDir, "folder")}>📁</button>
      </div>
      {selectedDir && (
        <div className="target-dir" title="New items are created here">
          in <b>{selectedDir}</b> <button onClick={() => setSelectedDir("")}>×</button>
        </div>
      )}
      <div
        className={`tree ${dropTarget === "" ? "drop" : ""}`}
        {...dropProps("")}
        onClick={(e) => e.target === e.currentTarget && setSelectedDir("")}
        onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, node: null }); }}
      >
        {tree.map((n) => renderNode(n, 0))}
      </div>
      <div className="sidebar-foot">
        <a href="/api/export.zip" title="Download every file as a zip">⬇ Export all (.zip)</a>
      </div>
      {menu && (
        <div className="menu" style={{ left: menu.x, top: Math.min(menu.y, window.innerHeight - 320) }} onClick={(e) => e.stopPropagation()}>
          <button onClick={() => { setMenu(null); createIn(mDir, "page"); }}>📄 New page</button>
          <button onClick={() => { setMenu(null); createIn(mDir, "whiteboard"); }}>🎨 New whiteboard</button>
          <button onClick={() => { setMenu(null); createIn(mDir, "file"); }}>📝 New file</button>
          <button onClick={() => { setMenu(null); createIn(mDir, "folder"); }}>📁 New folder</button>
          {m && <hr />}
          {m && m.type === "file" && kindOf(m.path) !== "code" && (
            <button onClick={() => { setMenu(null); onOpen(m.path, { mode: "code" }); }}>🔤 Open as text</button>
          )}
          {m && <button onClick={() => { setMenu(null); setRenaming(m.path); }}>✏️ Rename</button>}
          {m && m.type === "file" && <a href={fileUrl(m.path)} download onClick={() => setMenu(null)}>⬇ Download</a>}
          {m && <button className="danger" onClick={() => { setMenu(null); onDelete(m.path); }}>🗑 Delete</button>}
        </div>
      )}
    </aside>
  );
}

function RenameInput({ initial, onDone }) {
  const ref = useRef(null);
  const done = useRef(false);
  useEffect(() => {
    const el = ref.current;
    el.focus();
    const dot = initial.lastIndexOf(".");
    el.setSelectionRange(0, dot > 0 ? dot : initial.length);
  }, [initial]);
  const finish = (value) => {
    if (done.current) return;
    done.current = true;
    const v = value?.trim();
    onDone(v && v !== initial && !/[\\/]/.test(v) ? v : null);
  };
  return (
    <input
      ref={ref}
      className="rename"
      defaultValue={initial}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(e.currentTarget.value);
        if (e.key === "Escape") finish(null);
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
    />
  );
}
