// Copy Excalidraw's fonts into public/ so whiteboards work fully offline.
import { cpSync, existsSync } from "node:fs";

const src = "node_modules/@excalidraw/excalidraw/dist/prod/fonts";
if (existsSync(src)) cpSync(src, "public/excalidraw-assets/fonts", { recursive: true });
