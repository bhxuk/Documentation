// How each file is opened, and small path helpers.

export function kindOf(path) {
  if (path.endsWith(".excalidraw")) return "whiteboard";
  if (path.toLowerCase().endsWith(".md")) return "page";
  if (/\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i.test(path)) return "image";
  return "code";
}

export const baseName = (path) => path.split("/").pop();
export const dirName = (path) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
export const join = (dir, name) => (dir ? `${dir}/${name}` : name);

export function displayName(path) {
  const name = baseName(path);
  if (name.endsWith(".excalidraw")) return name.slice(0, -".excalidraw".length);
  if (name.toLowerCase().endsWith(".md")) return name.slice(0, -3);
  return name;
}

// Keep the extension that defines the file's kind when renaming from a display name.
export function withSuffix(path, newDisplay) {
  const name = baseName(path);
  if (name.endsWith(".excalidraw")) return newDisplay + ".excalidraw";
  if (name.toLowerCase().endsWith(".md")) return newDisplay + name.slice(-3);
  return newDisplay;
}

export function icon(kind, open) {
  return { folder: open ? "📂" : "📁", page: "📄", whiteboard: "🎨", image: "🖼️", code: "📝" }[kind] || "📝";
}

export function flatten(tree, out = []) {
  for (const n of tree) {
    if (n.type === "folder") flatten(n.children, out);
    else out.push(n.path);
  }
  return out;
}

export const EMPTY_WHITEBOARD = JSON.stringify(
  { type: "excalidraw", version: 2, source: "documentation", elements: [], appState: { viewBackgroundColor: "#ffffff" }, files: {} },
  null,
  2
);

export const EMPTY_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="120" viewBox="0 0 400 120"><rect width="400" height="120" rx="8" fill="#f4f4f5"/><text x="200" y="66" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#71717a">Empty whiteboard</text></svg>';
