export const $ = s => document.querySelector(s);

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ESC[c]);

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY = 86400000;

export function shortDate(ts) {
  if (!ts) return "";
  const d = new Date(ts), now = new Date();
  return MON[d.getMonth()] + " " + d.getDate() + (d.getFullYear() !== now.getFullYear() ? ", " + d.getFullYear() : "");
}

// "today", "yesterday", "3 days ago", then a date.
export function when(ts) {
  if (!ts) return "";
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ts >= start) return "today";
  if (ts >= start - DAY) return "yesterday";
  const days = Math.floor((start - ts) / DAY) + 1;
  return days < 7 ? days + " days ago" : shortDate(ts);
}

export function ago(ts) {
  const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (m < 1) return "updated just now";
  if (m < 60) return "updated " + m + "m ago";
  const h = Math.round(m / 60);
  if (h < 24) return "updated " + h + "h ago";
  return "updated " + Math.round(h / 24) + "d ago";
}

export const plural = (n, word) => n + " " + word + (n === 1 ? "" : "s");
export const padTag = n => String(n || 0).padStart(3, "0");
export const firstLetter = name => (name || "?").trim().charAt(0).toUpperCase();

let toastTimer;
export function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2400);
}

export function errorText(e) {
  if (e && e.name === "QuotaExceededError") return "Your phone's storage for this app is full. Delete a few items and try again.";
  return (e && e.message) || "That didn't save. Please try again.";
}

// Two-tap confirm: the first tap arms it, and it disarms itself after 3 seconds.
export function twoTap(onChange) {
  let armed = null, timer;
  const set = key => { armed = key; clearTimeout(timer); onChange(); };
  return {
    isArmed: key => armed === key,
    disarm: () => set(null),
    tap(key, confirm) {
      if (armed === key) { set(null); confirm(); return; }
      set(key);
      timer = setTimeout(() => set(null), 3000);
    }
  };
}
