// Notion-style page: a BlockNote editor that loads from and autosaves to a Markdown file.
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import { useEffect, useRef, useState } from "react";
import { filterSuggestionItems, insertOrUpdateBlockForSlashMenu } from "@blocknote/core";
import { useCreateBlockNote, SuggestionMenuController, getDefaultReactSlashMenuItems } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import { api, fileUrl } from "../api.js";
import { displayName, dirName, join, withSuffix } from "../files.js";

const SAVE_DELAY = 600;

export default function PageEditor({ path, theme, active, onDirty, onRename, onOpen, onCreateWhiteboard, notify }) {
  const editor = useCreateBlockNote({
    uploadFile: async (file) => (await api.upload(file)).url,
  });
  const [status, setStatus] = useState("loading");
  const [menuOpen, setMenuOpen] = useState(false);
  const pathRef = useRef(path);
  const lastSaved = useRef(null);
  const timer = useRef(null);
  const cb = useRef({});
  pathRef.current = path;
  cb.current = { onDirty, notify, onOpen, onCreateWhiteboard };

  // Load when the tab opens, and reload when it comes back into view if the file
  // changed on disk (e.g. edited as Markdown source) and we have nothing unsaved.
  const lastRaw = useRef(null);
  useEffect(() => {
    if (!active || timer.current) return;
    let cancelled = false;
    api.read(pathRef.current).then(
      ({ content }) => {
        if (cancelled || content === lastRaw.current || timer.current) return;
        const blocks = editor.tryParseMarkdownToBlocks(content);
        lastSaved.current = null;
        editor.replaceBlocks(editor.document, blocks.length ? blocks : [{ type: "paragraph" }]);
        lastRaw.current = content;
        lastSaved.current = editor.blocksToMarkdownLossy(editor.document);
        setStatus("saved");
      },
      (e) => { if (!cancelled && lastRaw.current === null) { setStatus("error"); cb.current.notify(`Could not open page: ${e.message}`); } }
    );
    return () => { cancelled = true; };
  }, [editor, active]);

  const save = async () => {
    clearTimeout(timer.current);
    timer.current = null;
    if (lastSaved.current === null) return;
    const md = editor.blocksToMarkdownLossy(editor.document);
    if (md === lastSaved.current) { setStatus("saved"); cb.current.onDirty(false); return; }
    setStatus("saving");
    try {
      await api.write(pathRef.current, md);
      lastSaved.current = md;
      lastRaw.current = md;
      setStatus("saved");
      if (!timer.current) cb.current.onDirty(false);
    } catch (e) {
      setStatus("error");
      cb.current.notify(`Save failed: ${e.message}`);
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;

  // Flush pending edits when the tab closes.
  useEffect(() => () => { if (timer.current) saveRef.current(); }, []);

  const onChange = () => {
    if (lastSaved.current === null) return;
    cb.current.onDirty(true);
    setStatus("editing");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => saveRef.current(), SAVE_DELAY);
  };

  const whiteboardItem = {
    title: "Whiteboard",
    subtext: "Create a whiteboard and embed its preview",
    aliases: ["excalidraw", "draw", "diagram", "sketch", "canvas"],
    group: "Media",
    icon: <span style={{ fontSize: 16 }}>🎨</span>,
    onItemClick: async () => {
      const block = insertOrUpdateBlockForSlashMenu(editor, { type: "image" });
      const boardPath = await cb.current.onCreateWhiteboard(dirName(pathRef.current));
      if (boardPath) editor.updateBlock(block, { props: { url: fileUrl(boardPath + ".svg"), name: displayName(boardPath) } });
    },
  };

  // Double-click an embedded whiteboard preview to open it.
  const onDoubleClick = (e) => {
    const src = e.target.tagName === "IMG" && e.target.getAttribute("src");
    if (src && src.startsWith("/files/") && src.endsWith(".excalidraw.svg")) {
      const p = decodeURIComponent(src.slice("/files/".length, -".svg".length));
      cb.current.onOpen(p);
    }
  };

  const onKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); save(); }
  };

  const commitTitle = async (value) => {
    const v = value.trim();
    if (!v || v === displayName(path) || /[\\/]/.test(v)) return;
    await onRename(path, join(dirName(path), withSuffix(path, v)));
  };

  return (
    <div className="page-scroll" onKeyDown={onKeyDown} onDoubleClick={onDoubleClick}>
      <div className="page-toolbar">
        <span className="crumbs">{dirName(path) ? dirName(path).split("/").join(" / ") + " /" : ""}</span>
        <span className={`save-state ${status}`}>{{ loading: "Loading…", editing: "Editing", saving: "Saving…", saved: "Saved", error: "Not saved" }[status]}</span>
        <div className="menu-wrap">
          <button className="icon-btn" onClick={() => setMenuOpen((o) => !o)} title="Page options">⋯</button>
          {menuOpen && (
            <div className="menu right" onMouseLeave={() => setMenuOpen(false)}>
              <a href={fileUrl(path)} download onClick={() => setMenuOpen(false)}>⬇ Export Markdown</a>
              <button onClick={() => { setMenuOpen(false); setTimeout(() => window.print(), 50); }}>🖨 Print / Save as PDF</button>
              <button onClick={() => { setMenuOpen(false); save().then(() => onOpen(path, { mode: "code" })); }}>🔤 Edit Markdown source</button>
            </div>
          )}
        </div>
      </div>
      <div className="page">
        <input
          key={path}
          className="page-title"
          defaultValue={displayName(path)}
          placeholder="Untitled"
          onBlur={(e) => commitTitle(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); editor.focus(); }
            if (e.key === "Escape") { e.currentTarget.value = displayName(path); e.currentTarget.blur(); }
          }}
        />
        <BlockNoteView editor={editor} theme={theme} onChange={onChange} slashMenu={false} editable={status !== "loading"}>
          <SuggestionMenuController
            triggerCharacter="/"
            getItems={async (query) => filterSuggestionItems([...getDefaultReactSlashMenuItems(editor), whiteboardItem], query)}
          />
        </BlockNoteView>
      </div>
    </div>
  );
}
