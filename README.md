# Documentation

A self-hosted documentation workspace that runs in one Docker container:

- **Pages** – a Notion-style block editor (slash `/` menu, headings, to-dos, toggles, tables, code blocks, images, drag-to-reorder). Saved as Markdown.
- **Code editor** – a Notepad++-style editor (Monaco): tabs, syntax highlighting for dozens of languages, find & replace, go to line, folding, word wrap, show whitespace, line-ending switch, `Ctrl+S` to save.
- **Whiteboards** – a full Excalidraw canvas, saved as standard `.excalidraw` files. Embed one in a page with `/whiteboard`; double-click the preview to open it.
- **Search & export** – `Ctrl+P` quick open, `Ctrl+Shift+F` search inside every file (including whiteboard text), print/PDF any page, download everything as a zip.

Everything is plain files in your data folder, so you can back it up, grep it or put it in git.

## Run it

```bash
docker compose up -d
```

Then open <http://localhost:3000>. Your files live in `./data` next to `docker-compose.yml`.

The image is published to `ghcr.io/bhxuk/documentation`. Because this repository is private, log in once before pulling:

```bash
echo <a GitHub token with read:packages> | docker login ghcr.io -u bhxuk --password-stdin
```

To update to the latest version:

```bash
docker compose pull && docker compose up -d
```

Without Docker Compose:

```bash
docker run -d --name documentation -p 3000:3000 -v ./data:/data --restart unless-stopped ghcr.io/bhxuk/documentation:latest
```

To build the image yourself instead of pulling it: `docker compose up -d --build`.

## How files are stored

| In the app | On disk |
| --- | --- |
| Page | `Name.md` |
| Whiteboard | `Name.excalidraw` plus a `Name.excalidraw.svg` preview (hidden in the app) |
| Code / text file | the file itself |
| Pasted or uploaded images | `_assets/` |
| Deleted items | moved to `.trash/` – empty it by hand when you're sure |

Pages autosave as you type; whiteboards autosave a second after you stop drawing; code files save on `Ctrl+S` (a ● on the tab means unsaved changes).

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| `Ctrl+P` / `Ctrl+K` | Quick open |
| `Ctrl+Shift+F` | Search in all files |
| `Ctrl+S` | Save |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Next / previous tab |
| `Alt+W` / middle-click | Close tab |
| `Ctrl+\` | Toggle sidebar |
| `/` (in a page) | Block menu |
| `Ctrl+F` / `Ctrl+H` / `Ctrl+G` (in code) | Find / replace / go to line |

Right-click anything in the sidebar to create, rename, download, delete or open a page as raw Markdown. Drag files onto folders to move them.

## Configuration

| Variable | Default | |
| --- | --- | --- |
| `PORT` | `3000` | Port inside the container |
| `DATA_DIR` | `/data` | Where files are stored |

There is no login: it's meant for your own machine or LAN. Put it behind a reverse proxy with authentication before exposing it to the internet.

## Development

```bash
cd server && npm install && node index.js       # API on :3000, data in ./data
cd client && npm install && npm run dev         # UI on :5173, proxies /api to :3000
```

Pushing to `main` builds and publishes the image (amd64 + arm64) via GitHub Actions. Bump `VERSION` and add a `CHANGELOG.md` entry with each release; the image is tagged with both `latest` and the version.
