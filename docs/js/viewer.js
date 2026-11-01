// Full-screen enlarged view: swipe between items, pinch and double-tap to zoom, swipe down to close.
import { $, esc, shortDate, padTag, firstLetter, toast, errorText, when } from "./util.js";
import { state, subscribe, containerOf, shortName, itemsIn, itemsOut, setStatus, setInsidePhoto } from "./store.js";
import { cachedThumb, loadThumbs, loadFull } from "./photos.js";
import { openEditor } from "./editor.js";

const MAX_ZOOM = 5;
const DOUBLE_TAP_ZOOM = 2.5;
const MAX_DOTS = 9;
const SLIDE_GAP = 16;

const viewer = $("#viewer"), stage = $("#v-stage"), track = $("#v-track");
let slides = [...track.querySelectorAll(".v-slide")]; // always [previous, current, next]

let entries = [];   // what can be swiped through
let index = 0;
let mode = "item";  // "item" | "inside"
let insideId = null;
let onRetake = null;
let busy = false;
let animating = false;

/* ---------- Entries ---------- */
const photoOf = entry => (mode === "item" ? entry.photo : entry.insidePhoto);

function itemEntries(item) {
  return item.status === "out" ? itemsOut() : itemsIn(item.containerId);
}

/* ---------- Full-size images, cached while the viewer is open ---------- */
const fulls = new Map();
function getFull(id) {
  if (!fulls.has(id)) fulls.set(id, loadFull(id));
  return fulls.get(id);
}
function clearFulls() {
  fulls.forEach(p => p.then(url => { if (url) URL.revokeObjectURL(url); }));
  fulls.clear();
}

/* ---------- Slides ---------- */
async function fillSlide(slide, entry) {
  const img = slide.querySelector("img"), letter = slide.querySelector(".v-letter");
  const key = entry ? entry.id : "";
  if (slide.dataset.key === key && (entry ? slide.dataset.photo === (photoOf(entry) || "") : true)) return;
  slide.dataset.key = key;
  const photo = entry ? photoOf(entry) : null;
  slide.dataset.photo = photo || "";

  img.hidden = !photo;
  img.removeAttribute("src");
  img.alt = entry ? entry.name : "";
  letter.hidden = !entry || !!photo;
  if (entry && !photo) letter.textContent = firstLetter(entry.name);
  if (!photo) return;

  await loadThumbs([photo]);
  if (slide.dataset.photo !== photo) return;
  if (!img.getAttribute("src")) img.src = cachedThumb(photo);
  const url = await getFull(photo);
  if (!url) return;
  // Decode first, so swapping from thumbnail to large photo never flashes blank.
  const pre = new Image();
  pre.src = url;
  await pre.decode().catch(() => {});
  if (slide.dataset.photo === photo) img.src = url;
}

function placeSlides() {
  track.classList.remove("settling");
  track.style.transform = "";
  slides.forEach((s, i) => {
    const pos = i - 1;
    s.style.transform = pos ? `translateX(calc(${pos * 100}% + ${pos * SLIDE_GAP}px))` : "";
  });
}

function fillAll() {
  placeSlides();
  fillSlide(slides[0], entries[index - 1]);
  fillSlide(slides[1], entries[index]);
  fillSlide(slides[2], entries[index + 1]);
}

/* ---------- Header, dots, sheet ---------- */
function renderChrome() {
  const entry = entries[index];
  if (mode === "item") {
    const label = entry.status === "out" ? "Taken out" : shortName(containerOf(entry.containerId));
    $("#v-caption").textContent = `${index + 1} of ${entries.length} · ${label}`;
  } else {
    $("#v-caption").textContent = "Inside view · " + shortName(entry);
  }
  $("#v-edit").style.visibility = mode === "item" ? "" : "hidden"; // keeps the caption centered
  $("#v-prev").hidden = index === 0;
  $("#v-next").hidden = index >= entries.length - 1;

  const n = entries.length;
  const count = Math.min(n, MAX_DOTS);
  const start = Math.max(0, Math.min(index - Math.floor(MAX_DOTS / 2), n - count));
  let dots = "";
  if (n > 1) for (let i = start; i < start + count; i++) dots += `<span${i === index ? ' class="on"' : ""}></span>`;
  $("#v-dots").innerHTML = dots;

  $("#v-sheet").innerHTML = mode === "item" ? itemSheet(entry) : insideSheet(entry);
}

function itemSheet(item) {
  const c = containerOf(item.containerId);
  const out = item.status === "out";
  const meta = [c ? c.name : "", item.section, "×" + item.qty].filter(Boolean).join(" · ");
  const row = (label, value, cls = "") => `<div><span>${label}</span><span class="${cls}">${esc(value)}</span></div>`;
  return `<span class="handle" data-handle></span>
    <div class="v-title"><h3>${esc(item.name)}</h3><span>${esc(meta)}</span></div>
    <div class="v-rows">
      ${row("Note", item.note || "None", item.note ? "" : "none")}
      ${row("Added", shortDate(item.addedAt))}
      ${out ? row("Taken out", shortDate(item.movedAt)) : ""}
      ${row("Tag", padTag(item.tag), "tabular")}
    </div>
    <button class="primary ${out ? "yellow" : "red"}" id="v-move">${out ? "Put back" : "Take out"}</button>`;
}

function insideSheet(c) {
  return `<span class="handle" data-handle></span>
    <div class="v-title"><h3>${esc(c.name)}</h3><span>Inside view from ${esc(when(c.insideAt))}</span></div>
    <button class="primary yellow" id="v-retake">Retake photo</button>
    <button class="plain" id="v-remove-inside">Remove photo</button>`;
}

$("#v-sheet").addEventListener("click", async e => {
  const b = e.target.closest("button");
  if (!b || busy) return;
  const entry = entries[index];
  if (b.id === "v-move") {
    const toOut = entry.status !== "out";
    busy = true;
    b.disabled = true;
    try {
      await setStatus(entry.id, toOut ? "out" : "in");
      close();
      const c = containerOf(entry.containerId);
      toast(toOut ? entry.name + " taken out" : entry.name + " back in " + (c ? c.name : "the trunk"));
    } catch (ex) {
      toast(errorText(ex));
      b.disabled = false;
    } finally { busy = false; }
  } else if (b.id === "v-retake") {
    if (onRetake) onRetake();
  } else if (b.id === "v-remove-inside") {
    try { await setInsidePhoto(entry.id, null); close(); toast("Inside view removed"); }
    catch (ex) { toast(errorText(ex)); }
  }
});

/* ---------- Open / close ---------- */
function setThemeBlack(on) {
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => {
    m.content = on ? "#000000" : m.dataset.base;
  });
}

function show() {
  animating = false;
  resetZoom(false);
  viewer.style.transform = "";
  viewer.style.opacity = "";
  viewer.classList.remove("settling");
  slides.forEach(s => { s.dataset.key = "__none"; });
  viewer.hidden = false;
  setThemeBlack(true);
  fillAll();
  renderChrome();
}

export function openItemViewer(item) {
  mode = "item";
  entries = itemEntries(item);
  index = Math.max(0, entries.findIndex(i => i.id === item.id));
  show();
}

export function openInsideViewer(container, retake) {
  mode = "inside";
  insideId = container.id;
  onRetake = retake;
  entries = [container];
  index = 0;
  show();
}

function close() {
  viewer.hidden = true;
  pointers.clear();
  gesture = null;
  setThemeBlack(false);
  slides.forEach(s => {
    const img = s.querySelector("img");
    img.removeAttribute("src");
    img.style.transform = "";
    s.dataset.key = "__none";
  });
  clearFulls();
  entries = [];
}

$("#v-close").addEventListener("click", close);
$("#v-edit").addEventListener("click", () => {
  if (mode === "item") openEditor(entries[index]);
});
$("#v-prev").addEventListener("click", () => go(-1));
$("#v-next").addEventListener("click", () => go(1));
document.addEventListener("keydown", e => {
  if (viewer.hidden || !$("#editor").hidden) return;
  if (e.key === "Escape") close();
  else if (e.key === "ArrowLeft" && index > 0) go(-1);
  else if (e.key === "ArrowRight" && index < entries.length - 1) go(1);
});

// An edit, retake or delete changes the data underneath, so rebuild from it.
subscribe(() => {
  if (viewer.hidden) return;
  if (mode === "item") {
    const id = entries[index] && entries[index].id;
    const item = state.items.find(i => i.id === id);
    if (!item) { close(); return; }
    entries = itemEntries(item);
    index = Math.max(0, entries.findIndex(i => i.id === id));
  } else {
    const c = containerOf(insideId);
    if (!c || !c.insidePhoto) { close(); return; }
    entries = [c];
    index = 0;
    resetZoom(false);
  }
  fillAll();
  renderChrome();
});

/* ---------- Moving between items ---------- */
function go(dir) {
  if (animating || !entries[index + dir]) return;
  animating = true;
  if (zoom.s > 1) resetZoom(false);
  const width = stage.clientWidth + SLIDE_GAP;
  track.classList.add("settling");
  track.style.transform = `translateX(${-dir * width}px)`;
  index += dir;
  renderChrome();

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    if (viewer.hidden) { animating = false; return; }
    slides = dir > 0 ? [slides[1], slides[2], slides[0]] : [slides[2], slides[0], slides[1]];
    resetZoom(false);
    fillAll();
    animating = false;
  };
  track.addEventListener("transitionend", finish, { once: true });
  setTimeout(finish, 280); // in case the transition never fires (reduced motion)
}

function settleTrack() {
  track.classList.add("settling");
  track.style.transform = "";
}

/* ---------- Zoom ---------- */
const zoom = { s: 1, x: 0, y: 0 };
const currentImg = () => slides[1].querySelector("img");
const canZoom = () => {
  const img = currentImg();
  return !img.hidden && img.naturalWidth > 0;
};

function applyZoom(animate) {
  const img = currentImg();
  img.classList.toggle("settling", !!animate);
  img.style.transform = zoom.s === 1 && !zoom.x && !zoom.y ? "" : `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.s})`;
}

function resetZoom(animate) {
  zoom.s = 1; zoom.x = 0; zoom.y = 0;
  viewer.classList.remove("zoomed");
  applyZoom(animate);
}

// The photo's on-screen size at zoom 1, inside the stage (object-fit: contain).
function baseSize() {
  const img = currentImg();
  const sw = stage.clientWidth, sh = stage.clientHeight;
  const fit = Math.min(sw / img.naturalWidth, sh / img.naturalHeight);
  return { w: img.naturalWidth * fit, h: img.naturalHeight * fit };
}

function stageCenter() {
  const r = stage.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function clampPan() {
  const { w, h } = baseSize();
  const c = stageCenter();
  const vw = viewer.clientWidth, vh = viewer.clientHeight;
  const hw = w * zoom.s / 2, hh = h * zoom.s / 2;
  zoom.x = hw * 2 <= vw ? vw / 2 - c.x : Math.min(hw - c.x, Math.max(vw - c.x - hw, zoom.x));
  zoom.y = hh * 2 <= vh ? 0 : Math.min(hh - c.y, Math.max(vh - c.y - hh, zoom.y));
}

// Zooms to `scale`, keeping the point px,py on the photo under the same spot on screen.
function zoomAround(px, py, scale) {
  const c = stageCenter();
  const ix = (px - c.x - zoom.x) / zoom.s, iy = (py - c.y - zoom.y) / zoom.s;
  zoom.s = scale;
  zoom.x = px - c.x - scale * ix;
  zoom.y = py - c.y - scale * iy;
}

function toggleZoom(px, py) {
  if (!canZoom()) return;
  if (zoom.s > 1) { resetZoom(true); return; }
  zoomAround(px, py, DOUBLE_TAP_ZOOM);
  viewer.classList.add("zoomed");
  clampPan();
  applyZoom(true);
}

/* ---------- Gestures ---------- */
const pointers = new Map();
let gesture = null;
let lastTap = { t: 0, x: 0, y: 0 };

const pinchInfo = () => {
  const [a, b] = [...pointers.values()];
  return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
};

function capture(el, e) {
  try { el.setPointerCapture(e.pointerId); } catch (_) { /* not a live pointer */ }
}

function startPinch() {
  const p = pinchInfo();
  const c = stageCenter();
  gesture = {
    type: "pinch", d0: p.d, s0: zoom.s,
    ix: (p.x - c.x - zoom.x) / zoom.s, iy: (p.y - c.y - zoom.y) / zoom.s
  };
  settleTrack();
}

function startOne(e) {
  gesture = {
    type: zoom.s > 1 ? "pan" : "pending",
    x0: e.clientX, y0: e.clientY, zx: zoom.x, zy: zoom.y,
    t0: performance.now(), moved: false
  };
}

stage.addEventListener("pointerdown", e => {
  if (e.target.closest("button") || animating) return;
  capture(stage, e);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2 && canZoom()) startPinch();
  else if (pointers.size === 1) startOne(e);
});

stage.addEventListener("pointermove", e => {
  if (!pointers.has(e.pointerId) || !gesture) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (gesture.type === "pinch") {
    if (pointers.size < 2) return;
    const p = pinchInfo();
    const c = stageCenter();
    zoom.s = Math.max(0.8, Math.min(MAX_ZOOM, gesture.s0 * p.d / gesture.d0));
    zoom.x = p.x - c.x - zoom.s * gesture.ix;
    zoom.y = p.y - c.y - zoom.s * gesture.iy;
    applyZoom(false);
    return;
  }

  const dx = e.clientX - gesture.x0, dy = e.clientY - gesture.y0;
  if (!gesture.moved && Math.hypot(dx, dy) > 8) gesture.moved = true;

  if (gesture.type === "pan") {
    if (!gesture.moved) return;
    zoom.x = gesture.zx + dx;
    zoom.y = gesture.zy + dy;
    clampPan();
    applyZoom(false);
  } else if (gesture.type === "pending") {
    if (!gesture.moved) return;
    gesture.type = Math.abs(dx) > Math.abs(dy) ? "swipe" : (dy > 0 ? "dismiss" : "none");
    gesture.x0 = e.clientX; gesture.y0 = e.clientY; gesture.t0 = performance.now();
  } else if (gesture.type === "swipe") {
    const edge = (dx > 0 && index === 0) || (dx < 0 && index >= entries.length - 1);
    track.classList.remove("settling");
    track.style.transform = `translateX(${edge ? dx * 0.3 : dx}px)`;
  } else if (gesture.type === "dismiss") {
    dragDismiss(Math.max(0, dy));
  }
});

function dragDismiss(dy) {
  viewer.classList.remove("settling");
  viewer.style.transform = `translateY(${dy}px)`;
  viewer.style.opacity = String(Math.max(0.4, 1 - dy / 600));
}

function endDismiss(dy, dt) {
  const fast = dy / Math.max(dt, 1) > 0.6;
  viewer.classList.add("settling");
  if (dy > 110 || (fast && dy > 30)) {
    viewer.style.transform = `translateY(${viewer.clientHeight}px)`;
    viewer.style.opacity = "0";
    setTimeout(close, 220);
  } else {
    viewer.style.transform = "";
    viewer.style.opacity = "";
  }
}

function endGesture(e) {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  if (!gesture) return;

  if (gesture.type === "pinch") {
    if (pointers.size === 1) {
      finishPinch();
      const [p] = pointers.values();
      gesture = { type: zoom.s > 1 ? "pan" : "none", x0: p.x, y0: p.y, zx: zoom.x, zy: zoom.y, t0: performance.now(), moved: true };
    } else if (!pointers.size) {
      finishPinch();
      gesture = null;
    }
    return;
  }
  if (pointers.size) return;

  const dx = e.clientX - gesture.x0, dy = e.clientY - gesture.y0;
  const dt = performance.now() - gesture.t0;
  const g = gesture;
  gesture = null;

  if (e.type === "pointercancel") {
    settleTrack();
    if (g.type === "dismiss") endDismiss(0, 1);
    return;
  }
  if (g.type === "swipe") {
    const dir = dx < 0 ? 1 : -1;
    const fast = Math.abs(dx) / Math.max(dt, 1) > 0.5 && Math.abs(dx) > 30;
    if ((Math.abs(dx) > stage.clientWidth * 0.25 || fast) && entries[index + dir]) go(dir);
    else settleTrack();
  } else if (g.type === "dismiss") {
    endDismiss(dy, dt);
  } else if (!g.moved && dt < 350) {
    const now = performance.now();
    if (now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40) {
      lastTap.t = 0;
      toggleZoom(e.clientX, e.clientY);
    } else {
      lastTap = { t: now, x: e.clientX, y: e.clientY };
    }
  }
}

function finishPinch() {
  if (zoom.s <= 1.02) { resetZoom(true); return; }
  viewer.classList.add("zoomed");
  clampPan();
  applyZoom(true);
}

stage.addEventListener("pointerup", endGesture);
stage.addEventListener("pointercancel", endGesture);

/* Dragging the sheet's handle also dismisses. */
const sheet = $("#v-sheet");
let handleDrag = null;
sheet.addEventListener("pointerdown", e => {
  if (!e.target.hasAttribute("data-handle")) return;
  capture(sheet, e);
  handleDrag = { id: e.pointerId, y0: e.clientY, t0: performance.now() };
});
sheet.addEventListener("pointermove", e => {
  if (handleDrag && e.pointerId === handleDrag.id) dragDismiss(Math.max(0, e.clientY - handleDrag.y0));
});
const endHandle = e => {
  if (!handleDrag || e.pointerId !== handleDrag.id) return;
  endDismiss(Math.max(0, e.clientY - handleDrag.y0), performance.now() - handleDrag.t0);
  handleDrag = null;
};
sheet.addEventListener("pointerup", endHandle);
sheet.addEventListener("pointercancel", endHandle);

// iOS Safari's own page-pinch has to be stopped for the app's zoom to work.
document.addEventListener("gesturestart", e => e.preventDefault());
