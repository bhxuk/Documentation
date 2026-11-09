async function req(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

const q = (p) => encodeURIComponent(p);

export const api = {
  tree: () => req("GET", "/api/tree"),
  read: (path) => req("GET", `/api/file?path=${q(path)}`),
  write: (path, content) => req("PUT", `/api/file?path=${q(path)}`, { content }),
  create: (path, type = "file", content = "") => req("POST", "/api/create", { path, type, content }),
  rename: (from, to) => req("POST", "/api/rename", { from, to }),
  remove: (path) => req("DELETE", `/api/file?path=${q(path)}`),
  search: (text) => req("GET", `/api/search?q=${q(text)}`),
  async upload(file) {
    const res = await fetch(`/api/upload?name=${q(file.name || "image.png")}`, { method: "POST", body: file });
    if (!res.ok) throw new Error("upload failed");
    return res.json();
  },
};

export const fileUrl = (path) => "/files/" + path.split("/").map(encodeURIComponent).join("/");
