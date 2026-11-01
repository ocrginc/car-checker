// App state and every change to it. Each change saves to IndexedDB, then tells the screens.
import { getAll, get, write } from "./db.js";
import { dropThumb } from "./photos.js";

// Each container has its own sections: [{ name, color }]. Items store the section's name.
const SECTION_COLORS = ["red", "blue", "green", "yellow", "black", "purple", "orange", "teal"];
const STARTER_SECTIONS = [
  { name: "Underwear", color: "yellow" },
  { name: "Socks", color: "red" },
  { name: "Jackets", color: "green" },
  { name: "Sweats", color: "blue" },
  { name: "Shorts", color: "black" }
];
export const OLD_DAYS = 30;
const DAY = 86400000;

export const state = { items: [], containers: [], nextTag: 1 };

const listeners = new Set();
export const subscribe = fn => listeners.add(fn);
const emit = () => listeners.forEach(fn => fn());

const newId = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export async function load() {
  const [items, containers, nextTag, seeded] = await Promise.all([
    getAll("items"), getAll("containers"), get("meta", "nextTag"), get("meta", "seeded")
  ]);
  state.items = items;
  state.containers = containers;
  state.nextTag = nextTag || 1;
  if (!seeded) {
    const seed = [
      { id: "c-storage", name: "Storage container", short: "Storage", order: 1 },
      { id: "c-shoes", name: "Shoe container", short: "Shoes", order: 2 },
      { id: "c-loose", name: "Loose in trunk", short: "Loose", order: 3 }
    ].map(c => ({ ...c, sections: c.id === "c-storage" ? starterSections() : [], insidePhoto: null, insideAt: null }));
    await write(["containers", "meta"], s => {
      seed.forEach(c => s.containers.put(c));
      s.meta.put(true, "seeded");
    });
    state.containers = seed;
  }
  await addMissingSections();
  sortContainers();
}

const starterSections = () => STARTER_SECTIONS.map(s => ({ ...s }));

// Data saved before sections were editable has none on its containers. Nothing is lost:
// any section an item already uses is kept.
async function addMissingSections() {
  const older = state.containers.filter(c => !c.sections);
  if (!older.length) return;
  older.forEach(c => {
    c.sections = c.id === "c-storage" ? starterSections() : [];
    state.items.filter(i => i.containerId === c.id && i.section).forEach(i => {
      if (!findSection(c, i.section)) c.sections.push({ name: i.section, color: nextColor(c, i.section) });
    });
  });
  await write(["containers"], s => older.forEach(c => s.containers.put(c)));
}

const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
const findSection = (c, name) => c.sections.find(s => sameName(s.name, name));

// Familiar names keep their usual color. Others take the first color this container isn't using.
function nextColor(c, name) {
  const starter = STARTER_SECTIONS.find(s => sameName(s.name, name));
  const used = c.sections.map(s => s.color);
  if (starter && !used.includes(starter.color)) return starter.color;
  return SECTION_COLORS.find(k => !used.includes(k)) || SECTION_COLORS[c.sections.length % SECTION_COLORS.length];
}

const sortContainers = () => state.containers.sort((a, b) => a.order - b.order);

export const containerOf = id => state.containers.find(c => c.id === id);
export const shortName = c => (c && (c.short || c.name)) || "";

// The order items appear in, shared by the grid and the viewer's swipe.
export const itemsIn = containerId => state.items
  .filter(i => i.status === "in" && i.containerId === containerId)
  .sort((a, b) => b.addedAt - a.addedAt);
export const itemsOut = () => state.items
  .filter(i => i.status === "out")
  .sort((a, b) => (b.movedAt || 0) - (a.movedAt || 0));
export const outCutoff = () => Date.now() - OLD_DAYS * DAY;

function putPhoto(store, id, photo) {
  store.put(photo.thumb, id + ":thumb");
  store.put(photo.full, id + ":full");
}
function deletePhoto(store, id) {
  store.delete(id + ":thumb");
  store.delete(id + ":full");
}

export async function addItem(fields, photo) {
  const now = Date.now();
  const photoId = photo ? newId("p") : null;
  const item = {
    id: newId("i"), ...fields, photo: photoId, status: "in",
    tag: state.nextTag, addedAt: now, movedAt: null, updatedAt: now
  };
  // The tag counter only goes up, so a deleted item's number is never used again.
  await write(["items", "photos", "meta"], s => {
    s.items.put(item);
    s.meta.put(item.tag + 1, "nextTag");
    if (photo) putPhoto(s.photos, photoId, photo);
  });
  state.nextTag = item.tag + 1;
  state.items.push(item);
  emit();
  return item;
}

// photo: undefined keeps the current one, null removes it, an object replaces it.
export async function updateItem(id, fields, photo) {
  const old = state.items.find(i => i.id === id);
  const next = { ...old, ...fields, updatedAt: Date.now() };
  const replacing = photo !== undefined;
  if (replacing) next.photo = photo ? newId("p") : null;
  await write(["items", "photos"], s => {
    s.items.put(next);
    if (replacing && old.photo) deletePhoto(s.photos, old.photo);
    if (photo) putPhoto(s.photos, next.photo, photo);
  });
  if (replacing && old.photo) dropThumb(old.photo);
  Object.assign(old, next);
  emit();
}

export async function setStatus(id, status) {
  const old = state.items.find(i => i.id === id);
  const next = { ...old, status, movedAt: Date.now() };
  await write(["items"], s => s.items.put(next));
  Object.assign(old, next);
  emit();
}

async function deleteItems(list) {
  await write(["items", "photos"], s => list.forEach(i => {
    s.items.delete(i.id);
    if (i.photo) deletePhoto(s.photos, i.photo);
  }));
  list.forEach(i => { if (i.photo) dropThumb(i.photo); });
  const gone = new Set(list.map(i => i.id));
  state.items = state.items.filter(i => !gone.has(i.id));
  emit();
}

export const deleteItem = id => deleteItems(state.items.filter(i => i.id === id));
export const clearOlder = () => {
  const cutoff = outCutoff();
  return deleteItems(state.items.filter(i => i.status === "out" && (i.movedAt || 0) < cutoff));
};

export async function addContainer(name) {
  const order = state.containers.reduce((m, c) => Math.max(m, c.order), 0) + 1;
  const c = { id: newId("c"), name, short: null, order, sections: [], insidePhoto: null, insideAt: null };
  await write(["containers"], s => s.containers.put(c));
  state.containers.push(c);
  sortContainers();
  emit();
  return c;
}

export async function renameContainer(id, name) {
  const c = containerOf(id);
  const next = { ...c, name, short: null }; // the old short label no longer fits the new name
  await write(["containers"], s => s.containers.put(next));
  Object.assign(c, next);
  emit();
}

export async function removeContainer(id) {
  if (state.items.some(i => i.containerId === id)) throw new Error("Move or delete its items first.");
  const c = containerOf(id);
  await write(["containers", "photos"], s => {
    s.containers.delete(id);
    if (c.insidePhoto) deletePhoto(s.photos, c.insidePhoto);
  });
  if (c.insidePhoto) dropThumb(c.insidePhoto);
  state.containers = state.containers.filter(x => x.id !== id);
  emit();
}

export async function addSection(containerId, name) {
  const c = containerOf(containerId);
  if (findSection(c, name)) throw new Error(`${c.name} already has a section called ${name}.`);
  const sections = [...c.sections, { name, color: nextColor(c, name) }];
  await write(["containers"], s => s.containers.put({ ...c, sections }));
  c.sections = sections;
  emit();
}

// Renaming also updates the items in that section, in the same save.
export async function renameSection(containerId, oldName, name) {
  const c = containerOf(containerId);
  const clash = findSection(c, name);
  if (clash && !sameName(clash.name, oldName)) throw new Error(`${c.name} already has a section called ${name}.`);
  const sections = c.sections.map(s => (s.name === oldName ? { ...s, name } : s));
  const moved = state.items.filter(i => i.containerId === containerId && i.section === oldName);
  await write(["containers", "items"], s => {
    s.containers.put({ ...c, sections });
    moved.forEach(i => s.items.put({ ...i, section: name }));
  });
  c.sections = sections;
  moved.forEach(i => { i.section = name; });
  emit();
}

export async function removeSection(containerId, name) {
  if (state.items.some(i => i.containerId === containerId && i.section === name)) {
    throw new Error("Move or delete its items first.");
  }
  const c = containerOf(containerId);
  const sections = c.sections.filter(s => s.name !== name);
  await write(["containers"], s => s.containers.put({ ...c, sections }));
  c.sections = sections;
  emit();
}

// photo: an object replaces the inside view, null removes it.
export async function setInsidePhoto(id, photo) {
  const c = containerOf(id);
  const next = { ...c, insidePhoto: photo ? newId("p") : null, insideAt: photo ? Date.now() : null };
  await write(["containers", "photos"], s => {
    s.containers.put(next);
    if (c.insidePhoto) deletePhoto(s.photos, c.insidePhoto);
    if (photo) putPhoto(s.photos, next.insidePhoto, photo);
  });
  if (c.insidePhoto) dropThumb(c.insidePhoto);
  Object.assign(c, next);
  emit();
}
