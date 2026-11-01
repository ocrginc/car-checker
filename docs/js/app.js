// Home screen and Taken out tab.
import { $, esc, ago, plural, when, firstLetter, toast, errorText, twoTap } from "./util.js";
import {
  state, load, subscribe, SECTIONS, OLD_DAYS, containerOf, shortName,
  itemsIn, itemsOut, outCutoff, clearOlder, setInsidePhoto
} from "./store.js";
import { cachedThumb, loadThumbs, processPhoto } from "./photos.js";
import { openEditor, openContainers, editorDefaults } from "./editor.js";
import { openItemViewer, openInsideViewer } from "./viewer.js";

let tab = "in";
let segment = "all"; // "all" or a container id
let section = "";    // section chip, only when one container is selected
let query = "";
let showOlder = false;

const clearArm = twoTap(() => render());

const terms = () => query.toLowerCase().split(/\s+/).filter(Boolean);
function matches(item, words) {
  if (!words.length) return true;
  const c = containerOf(item.containerId);
  const hay = [item.name, item.note, item.section, c && c.name].join(" ").toLowerCase();
  return words.every(w => hay.includes(w));
}

function tileHTML(item, subline) {
  const thumb = item.photo ? cachedThumb(item.photo) : "";
  const pic = item.photo
    ? `<img alt="" data-photo="${esc(item.photo)}"${thumb ? ` src="${thumb}"` : ""}>`
    : `<span class="letter">${esc(firstLetter(item.name))}</span>`;
  const qty = item.qty > 1 ? `<span class="qty">×${item.qty}</span>` : "";
  const sub = subline ? `<span class="t-sec">${esc(subline)}</span>` : "";
  return `<button class="tile" data-item="${esc(item.id)}"><span class="pic">${pic}${qty}</span><span class="t-name">${esc(item.name)}</span>${sub}</button>`;
}

const gridHTML = (list, sub) => `<div class="grid">${list.map(i => tileHTML(i, sub(i))).join("")}</div>`;

function renderSegments() {
  const seg = (id, label) => `<button data-seg="${esc(id)}" aria-pressed="${segment === id}">${esc(label)}</button>`;
  $("#segments").innerHTML = seg("all", "All") + state.containers.map(c => seg(c.id, shortName(c))).join("");
}

function renderChips(inContainer) {
  const used = SECTIONS.filter(s => inContainer.some(i => i.section === s));
  if (section && !used.includes(section)) section = "";
  $("#chips").hidden = !used.length;
  $("#chips").innerHTML = used.map(s => `<button data-chip="${esc(s)}" data-section="${esc(s)}" aria-pressed="${section === s}">${esc(s)}</button>`).join("");
}

function renderTrunk(words) {
  const shown = segment === "all" ? state.containers : [containerOf(segment)];
  $("#chips").hidden = segment === "all";
  if (segment !== "all") renderChips(itemsIn(segment));
  else section = "";

  let html = "";
  for (const c of shown) {
    const list = itemsIn(c.id).filter(i => matches(i, words) && (!section || i.section === section));
    if (words.length && !list.length) continue;
    const body = list.length
      ? gridHTML(list, i => i.section)
      : `<p class="empty">${section ? "Nothing in this section." : "Nothing here yet."}</p>`;
    html += `<section><div class="group-head"><h2>${esc(c.name)} <span class="count">· ${list.length}</span></h2>` +
      `<button class="inside-link" data-inside="${esc(c.id)}">Inside view</button></div><div class="bin">${body}</div></section>`;
  }
  if (!state.containers.length) html = `<p class="status">No containers yet. Tap Containers to add one.</p>`;
  if (!html) html = `<p class="status">Nothing in the trunk matches “${esc(query)}”.</p>`;
  $("#list").innerHTML = html;

  // Search is limited to what's selected, so say when there's more elsewhere.
  const visible = new Set(shown.map(c => c.id));
  const hintEl = $("#hint");
  const others = words.length ? state.items.filter(i => matches(i, words) && !(i.status === "in" && visible.has(i.containerId))).length : 0;
  hintEl.hidden = !others;
  hintEl.textContent = others ? others + " more outside this view." : "";
}

function renderOut(words) {
  $("#chips").hidden = true;
  const list = itemsOut().filter(i => matches(i, words));
  const cutoff = outCutoff();
  const sub = i => "Out " + when(i.movedAt);
  const recent = words.length ? list : list.filter(i => (i.movedAt || 0) >= cutoff);
  const older = words.length ? [] : list.filter(i => (i.movedAt || 0) < cutoff);

  let html = recent.length ? `<section class="bin">${gridHTML(recent, sub)}</section>` : "";
  if (older.length) {
    html += `<section class="older bin"><div class="older-head"><span>${plural(older.length, "older item")}, out over ${OLD_DAYS} days</span>` +
      `<span class="older-actions"><button data-older-toggle>${showOlder ? "Hide" : "Show"}</button>` +
      `<button class="clear" data-older-clear>${clearArm.isArmed("older") ? "Tap again to clear" : "Clear them"}</button></span></div>` +
      (showOlder ? gridHTML(older, sub) : "") + `</section>`;
  }
  if (!html) {
    html = `<p class="status">${words.length ? `Nothing taken out matches “${esc(query)}”.` : "Nothing taken out. When you grab something from the trunk, tap its photo, then Take out."}</p>`;
  }
  $("#list").innerHTML = html;

  const others = words.length ? state.items.filter(i => i.status === "in" && matches(i, words)).length : 0;
  $("#hint").hidden = !others;
  $("#hint").textContent = others ? others + " more in the trunk." : "";
}

function subtitle(inCount, outCount) {
  const last = state.items.reduce((m, i) => Math.max(m, i.addedAt || 0, i.movedAt || 0, i.updatedAt || 0), 0);
  return `<span class="tape yellow">${inCount} in</span><span class="tape red">${outCount} out</span>` +
    (last ? `<span class="updated">${esc(ago(last))}</span>` : "");
}

function render() {
  const inCount = state.items.filter(i => i.status === "in").length;
  const outCount = state.items.length - inCount;
  if (segment !== "all" && !containerOf(segment)) { segment = "all"; section = ""; }

  $("#title").textContent = tab === "in" ? "Trunk" : "Taken out";
  $("#subtitle").innerHTML = subtitle(inCount, outCount);
  $("#tab-in").toggleAttribute("aria-current", false);
  $("#tab-out").toggleAttribute("aria-current", false);
  $(tab === "in" ? "#tab-in" : "#tab-out").setAttribute("aria-current", "page");
  const badge = $("#out-badge");
  badge.hidden = !outCount;
  badge.textContent = outCount > 99 ? "99+" : outCount;

  $("#segments").hidden = tab !== "in";
  if (tab === "in") renderSegments();

  const words = terms();
  if (tab === "in") renderTrunk(words); else renderOut(words);
  fillThumbs();
}

// Tiles render straight away, and any thumbnail not loaded yet fills in right after.
async function fillThumbs() {
  const pending = [...document.querySelectorAll("#list img[data-photo]:not([src])")];
  if (!pending.length) return;
  await loadThumbs(pending.map(img => img.dataset.photo));
  pending.forEach(img => {
    const url = cachedThumb(img.dataset.photo);
    if (url) img.src = url;
  });
}

/* Events */
$("#list").addEventListener("click", e => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.item) {
    const item = state.items.find(i => i.id === b.dataset.item);
    if (item) openItemViewer(item);
  } else if (b.dataset.inside) {
    openInside(b.dataset.inside);
  } else if ("olderToggle" in b.dataset) {
    showOlder = !showOlder;
    render();
  } else if ("olderClear" in b.dataset) {
    clearArm.tap("older", async () => {
      try { await clearOlder(); toast("Cleared"); showOlder = false; }
      catch (ex) { toast(errorText(ex)); }
    });
  }
});

let insideTarget = null;
function openInside(id) {
  const c = containerOf(id);
  if (!c) return;
  if (c.insidePhoto) { openInsideViewer(c, () => pickInside(id)); return; }
  pickInside(id);
}
function pickInside(id) {
  insideTarget = id;
  $("#inside-input").click();
}
$("#inside-input").addEventListener("change", async e => {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!file || !insideTarget) return;
  const id = insideTarget;
  toast("Saving inside view…");
  try {
    await setInsidePhoto(id, await processPhoto(file));
    toast("Inside view saved");
  } catch (ex) { toast(errorText(ex)); }
});

$("#segments").addEventListener("click", e => {
  const b = e.target.closest("button[data-seg]");
  if (!b) return;
  segment = b.dataset.seg;
  section = "";
  render();
  $("#scroller").scrollTop = 0;
});
$("#chips").addEventListener("click", e => {
  const b = e.target.closest("button[data-chip]");
  if (!b) return;
  section = section === b.dataset.chip ? "" : b.dataset.chip;
  render();
});
$("#q").addEventListener("input", e => { query = e.target.value.trim(); render(); });
$("#search-form").addEventListener("submit", e => { e.preventDefault(); $("#q").blur(); });

function setTab(next) {
  if (tab === next) { $("#scroller").scrollTo({ top: 0, behavior: "smooth" }); return; }
  tab = next;
  clearArm.disarm();
  $("#scroller").scrollTop = 0;
  render();
}
$("#tab-in").addEventListener("click", () => setTab("in"));
$("#tab-out").addEventListener("click", () => setTab("out"));

$("#btn-containers").addEventListener("click", openContainers);
$("#btn-add").addEventListener("click", () => {
  const preset = segment !== "all" ? { containerId: segment, section } : {};
  openEditor(null, { ...editorDefaults(), ...preset }, () => { if (tab !== "in") setTab("in"); });
});

// Keeps "updated 2h ago" honest when coming back to the app.
document.addEventListener("visibilitychange", () => { if (!document.hidden) render(); });

/* Boot */
(async () => {
  try {
    await load();
    subscribe(render);
    render();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  } catch (ex) {
    $("#list").innerHTML = `<p class="status">Your trunk couldn't be opened on this phone. ${esc(errorText(ex))}</p>`;
  }
})();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
