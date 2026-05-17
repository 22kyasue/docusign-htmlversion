#!/usr/bin/env node
// Copy pdfjs-dist worker into public/ so the browser can load it as a static asset.
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const src = path.join(root, "node_modules", "pdfjs-dist", "build", "pdf.worker.min.mjs");
const dst = path.join(root, "public", "pdf.worker.min.mjs");

if (!existsSync(src)) {
  console.error("pdfjs worker not found at " + src + " — did you run npm install?");
  process.exit(1);
}
mkdirSync(path.dirname(dst), { recursive: true });
copyFileSync(src, dst);
console.log("copied " + src + " -> " + dst);
