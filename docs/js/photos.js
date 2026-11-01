// Photo processing and loading. Each photo is saved twice: a small thumbnail for the
// grid and a large version for the enlarged view.
// Saved as raw bytes rather than Blob objects, which iOS has been known to lose from IndexedDB.
import { get, getMany } from "./db.js";

const FULL_LONG_EDGE = 2000;
const THUMB_SHORT_EDGE = 400;
const THUMB_LONG_EDGE_MAX = 1200;

function canvasOf(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

// Halves repeatedly before the last step, so small tiles stay sharp instead of aliased.
function scaleTo(source, sw, sh, tw, th) {
  let cur = source, cw = sw, ch = sh, temp = null;
  while (cw / 2 >= tw && ch / 2 >= th) {
    const nw = Math.round(cw / 2), nh = Math.round(ch / 2);
    const next = canvasOf(nw, nh);
    const g = next.getContext("2d");
    g.imageSmoothingQuality = "high";
    g.drawImage(cur, 0, 0, nw, nh);
    if (temp) temp.width = 0;
    cur = temp = next; cw = nw; ch = nh;
  }
  const out = canvasOf(tw, th);
  const g = out.getContext("2d");
  g.fillStyle = "#fff"; // transparent PNGs would otherwise turn black as JPEG
  g.fillRect(0, 0, tw, th);
  g.imageSmoothingQuality = "high";
  g.drawImage(cur, 0, 0, tw, th);
  if (temp) temp.width = 0;
  return out;
}

async function encode(canvas, quality) {
  const blob = await new Promise(r => canvas.toBlob(r, "image/jpeg", quality));
  if (!blob) throw new Error("no blob");
  return { type: blob.type, data: await blob.arrayBuffer() };
}

export async function processPhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode(); // browsers apply the camera's rotation when decoding
    const w = img.naturalWidth, h = img.naturalHeight;

    const fs = Math.min(1, FULL_LONG_EDGE / Math.max(w, h));
    const fullCanvas = scaleTo(img, w, h, Math.round(w * fs), Math.round(h * fs));
    const full = await encode(fullCanvas, 0.82);

    const ts = Math.min(1, THUMB_SHORT_EDGE / Math.min(w, h), THUMB_LONG_EDGE_MAX / Math.max(w, h));
    const thumbCanvas = scaleTo(fullCanvas, fullCanvas.width, fullCanvas.height, Math.round(w * ts), Math.round(h * ts));
    const thumb = await encode(thumbCanvas, 0.8);

    fullCanvas.width = 0;
    thumbCanvas.width = 0;
    return { thumb, full };
  } catch (_) {
    throw new Error("That photo couldn't be read. Try a JPG or PNG.");
  } finally {
    URL.revokeObjectURL(url);
  }
}

const toUrl = rec => URL.createObjectURL(new Blob([rec.data], { type: rec.type }));

// Thumbnails stay cached for the session so re-renders never flicker.
const thumbs = new Map();

export const cachedThumb = id => thumbs.get(id) || "";

export async function loadThumbs(ids) {
  const missing = [...new Set(ids)].filter(id => id && !thumbs.has(id));
  if (!missing.length) return;
  const recs = await getMany("photos", missing.map(id => id + ":thumb"));
  recs.forEach((rec, i) => { if (rec) thumbs.set(missing[i], toUrl(rec)); });
}

export function dropThumb(id) {
  const u = thumbs.get(id);
  if (u) URL.revokeObjectURL(u);
  thumbs.delete(id);
}

export async function loadFull(id) {
  const rec = await get("photos", id + ":full");
  return rec ? toUrl(rec) : "";
}
