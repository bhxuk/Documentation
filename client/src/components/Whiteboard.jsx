// Excalidraw whiteboard stored as a standard .excalidraw file (opens on excalidraw.com too).
// Each save also writes <file>.excalidraw.svg, which pages embed as a preview.
import "@excalidraw/excalidraw/index.css";
import { useEffect, useRef, useState } from "react";
import { Excalidraw, exportToSvg, serializeAsJSON } from "@excalidraw/excalidraw";
import { api } from "../api.js";
import { EMPTY_SVG } from "../files.js";

const SAVE_DELAY = 1000;

export default function Whiteboard({ path, theme, active, onDirty, notify }) {
  const [initial, setInitial] = useState(null);
  const [status, setStatus] = useState("saved");
  const apiRef = useRef(null);
  const pathRef = useRef(path);
  const lastSaved = useRef(null);
  const timer = useRef(null);
  const cb = useRef({});
  pathRef.current = path;
  cb.current = { onDirty, notify };

  useEffect(() => {
    api.read(path).then(
      ({ content }) => {
        let data = {};
        try { data = content.trim() ? JSON.parse(content) : {}; } catch { cb.current.notify("Whiteboard file is not valid JSON; starting blank"); }
        lastSaved.current = content;
        setInitial({
          elements: data.elements || [],
          appState: { ...(data.appState || {}), collaborators: new Map() },
          files: data.files || {},
          scrollToContent: true,
        });
      },
      (e) => cb.current.notify(`Could not open whiteboard: ${e.message}`)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (active) apiRef.current?.refresh(); }, [active]);

  const save = async () => {
    clearTimeout(timer.current);
    timer.current = null;
    const ex = apiRef.current;
    if (!ex) return;
    const elements = ex.getSceneElements();
    const appState = ex.getAppState();
    const files = ex.getFiles();
    const json = serializeAsJSON(elements, appState, files, "local");
    if (json === lastSaved.current) { setStatus("saved"); cb.current.onDirty(false); return; }
    setStatus("saving");
    try {
      await api.write(pathRef.current, json);
      lastSaved.current = json;
      let svg = EMPTY_SVG;
      if (elements.length) {
        const el = await exportToSvg({ elements, appState: { ...appState, exportBackground: true, exportWithDarkMode: false }, files, exportPadding: 16 });
        svg = el.outerHTML;
      }
      await api.write(pathRef.current + ".svg", svg);
      setStatus("saved");
      cb.current.onDirty(false);
    } catch (e) {
      setStatus("error");
      cb.current.notify(`Save failed: ${e.message}`);
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => () => { if (timer.current) saveRef.current(); }, []);

  const onChange = () => {
    if (!apiRef.current || lastSaved.current === null) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      const ex = apiRef.current;
      const json = serializeAsJSON(ex.getSceneElements(), ex.getAppState(), ex.getFiles(), "local");
      if (json === lastSaved.current) { cb.current.onDirty(false); return; }
      cb.current.onDirty(true);
      setStatus("editing");
      saveRef.current();
    }, SAVE_DELAY);
  };

  if (!initial) return <div className="loading">Loading whiteboard…</div>;

  return (
    <div
      className="whiteboard"
      onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); e.stopPropagation(); save(); } }}
    >
      <Excalidraw
        excalidrawAPI={(a) => (apiRef.current = a)}
        initialData={initial}
        theme={theme}
        onChange={onChange}
        name={path.split("/").pop().replace(/\.excalidraw$/, "")}
        UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false } }}
      />
      <span className={`wb-status save-state ${status}`}>{{ editing: "Editing", saving: "Saving…", saved: "Saved", error: "Not saved" }[status]}</span>
    </div>
  );
}
