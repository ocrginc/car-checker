// Add/edit item sheet and the Containers sheet.
import { $, esc, plural, padTag, shortDate, toast, errorText, twoTap } from "./util.js";
import {
  state, SECTIONS, addItem, updateItem, deleteItem,
  addContainer, renameContainer, removeContainer
} from "./store.js";
import { cachedThumb, loadThumbs, processPhoto } from "./photos.js";

const NEW_CONTAINER = "__new";

/* ---------- Item sheet ---------- */
let editing = null;      // the item being edited, or null when adding
let afterSave = null;
let pending = null;      // Promise of the processed photo the user just picked
let previewUrl = "";
let removePhoto = false;
let busy = false;
let last = { containerId: "", section: "" };

export const editorDefaults = () => ({ ...last });

const deleteArm = twoTap(() => {
  $("#editor-delete").classList.toggle("armed", deleteArm.isArmed("del"));
  $("#editor-delete").textContent = deleteArm.isArmed("del") ? "Tap again to delete" : "Delete item";
});

function showError(msg) {
  const el = $("#editor-error");
  el.textContent = msg || "";
  el.hidden = !msg;
}

function setPreview(url) {
  const img = $("#picker-img");
  img.hidden = !url;
  $("#picker-empty").hidden = !!url;
  $("#remove-photo").hidden = !url;
  if (url) img.src = url; else img.removeAttribute("src");
}

function clearPreviewUrl() {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = "";
}

function fillContainers(selected) {
  const sel = $("#f-container");
  sel.innerHTML = state.containers.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("") +
    `<option value="${NEW_CONTAINER}">New container…</option>`;
  const has = state.containers.some(c => c.id === selected);
  sel.value = has ? selected : (state.containers[0] ? state.containers[0].id : NEW_CONTAINER);
  $("#new-container-row").hidden = sel.value !== NEW_CONTAINER;
}

export function openEditor(item, defaults = {}, onSaved = null) {
  editing = item;
  afterSave = onSaved;
  pending = null;
  removePhoto = false;
  clearPreviewUrl();
  showError("");
  deleteArm.disarm();

  $("#editor-title").textContent = item ? "Edit item" : "Add item";
  $("#f-name").value = item ? item.name : "";
  $("#f-note").value = item ? item.note || "" : "";
  $("#f-qty").value = item ? item.qty : 1;
  $("#f-new-container").value = "";
  $("#photo-input").value = "";
  fillContainers(item ? item.containerId : defaults.containerId);
  $("#f-section").innerHTML = `<option value="">None</option>` + SECTIONS.map(s => `<option>${esc(s)}</option>`).join("");
  $("#f-section").value = item ? item.section || "" : defaults.section || "";

  const tag = $("#editor-tag");
  tag.hidden = !item;
  tag.textContent = item ? "Tag " + padTag(item.tag) + " · Added " + shortDate(item.addedAt) : "";
  $("#editor-delete").hidden = !item;

  setPreview(null);
  if (item && item.photo) {
    loadThumbs([item.photo]).then(() => { if (editing === item && !pending && !removePhoto) setPreview(cachedThumb(item.photo)); });
  }
  $("#editor").hidden = false;
  $("#editor .panel-body").scrollTop = 0;
}

function closeEditor() {
  $("#editor").hidden = true;
  editing = null;
  pending = null;
  afterSave = null;
  clearPreviewUrl();
}

$("#editor-cancel").addEventListener("click", closeEditor);

$("#photo-input").addEventListener("change", e => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  showError("");
  removePhoto = false;
  clearPreviewUrl();
  previewUrl = URL.createObjectURL(file);
  setPreview(previewUrl);
  pending = processPhoto(file);
  pending.catch(ex => {
    showError(errorText(ex));
    pending = null;
    setPreview(null);
  });
});

$("#remove-photo").addEventListener("click", () => {
  pending = null;
  removePhoto = true;
  $("#photo-input").value = "";
  clearPreviewUrl();
  setPreview(null);
});

$("#f-container").addEventListener("change", () => {
  const isNew = $("#f-container").value === NEW_CONTAINER;
  $("#new-container-row").hidden = !isNew;
  if (isNew) $("#f-new-container").focus();
});

function clampQty(v) {
  return Math.min(99, Math.max(1, parseInt(v, 10) || 1));
}
$("#qty-minus").addEventListener("click", () => { $("#f-qty").value = clampQty($("#f-qty").value) - 1 || 1; });
$("#qty-plus").addEventListener("click", () => { $("#f-qty").value = clampQty(clampQty($("#f-qty").value) + 1); });

$("#editor-form").addEventListener("submit", async e => {
  e.preventDefault();
  if (busy) return;
  showError("");
  const name = $("#f-name").value.trim();
  if (!name) { showError("Give it a name so you can find it later."); $("#f-name").focus(); return; }
  let containerId = $("#f-container").value;
  const newName = $("#f-new-container").value.trim();
  if (containerId === NEW_CONTAINER && !newName) {
    showError("Name the new container, or pick one from the list.");
    $("#f-new-container").focus();
    return;
  }

  busy = true;
  const save = $("#editor-save");
  save.disabled = true;
  save.textContent = "Saving…";
  try {
    const photo = pending ? await pending : (removePhoto ? null : undefined);
    if (containerId === NEW_CONTAINER) containerId = (await addContainer(newName)).id;
    const fields = {
      name, containerId,
      section: $("#f-section").value,
      qty: clampQty($("#f-qty").value),
      note: $("#f-note").value.trim()
    };
    const wasEdit = !!editing;
    if (editing) await updateItem(editing.id, fields, photo);
    else await addItem(fields, photo || null);
    last = { containerId, section: fields.section };
    const done = afterSave;
    closeEditor();
    if (done) done();
    toast(wasEdit ? "Saved" : "Added " + name);
  } catch (ex) {
    showError(errorText(ex));
  } finally {
    busy = false;
    save.disabled = false;
    save.textContent = "Save";
  }
});

$("#editor-delete").addEventListener("click", () => {
  if (!editing) return;
  const { id, name } = editing;
  deleteArm.tap("del", async () => {
    try {
      closeEditor();
      await deleteItem(id);
      toast("Deleted " + name);
    } catch (ex) { toast(errorText(ex)); }
  });
});

/* ---------- Containers sheet ---------- */
const removeArm = twoTap(() => renderContainers());

function containersError(msg) {
  const el = $("#containers-error");
  el.textContent = msg || "";
  el.hidden = !msg;
}

function renderContainers() {
  $("#containers-list").innerHTML = state.containers.map(c => {
    const n = state.items.filter(i => i.containerId === c.id).length;
    const armed = removeArm.isArmed(c.id);
    return `<div class="row c-row"><input data-rename="${esc(c.id)}" value="${esc(c.name)}" maxlength="40" aria-label="Container name">` +
      `<button type="button" data-remove="${esc(c.id)}"${n ? " disabled" : ""}${armed ? ' class="armed"' : ""}>${n ? plural(n, "item") : armed ? "Tap again" : "Remove"}</button></div>`;
  }).join("") || `<div class="row"><span>No containers yet.</span></div>`;
}

export function openContainers() {
  containersError("");
  $("#new-container").value = "";
  renderContainers();
  $("#containers").hidden = false;
}

$("#containers-done").addEventListener("click", () => { $("#containers").hidden = true; });

$("#containers-list").addEventListener("change", async e => {
  const id = e.target.dataset.rename;
  if (!id) return;
  const name = e.target.value.trim();
  if (!name) { renderContainers(); return; }
  try { await renameContainer(id, name); containersError(""); }
  catch (ex) { containersError(errorText(ex)); }
});

$("#containers-list").addEventListener("click", e => {
  const b = e.target.closest("button[data-remove]");
  if (!b || b.disabled) return;
  const id = b.dataset.remove;
  removeArm.tap(id, async () => {
    try { await removeContainer(id); containersError(""); renderContainers(); }
    catch (ex) { containersError(errorText(ex)); }
  });
});

async function submitNewContainer() {
  const input = $("#new-container");
  const name = input.value.trim();
  if (!name) { input.focus(); return; }
  try {
    await addContainer(name);
    input.value = "";
    containersError("");
    renderContainers();
  } catch (ex) { containersError(errorText(ex)); }
}
$("#add-container").addEventListener("click", submitNewContainer);
$("#new-container").addEventListener("keydown", e => {
  if (e.key === "Enter") { e.preventDefault(); submitNewContainer(); }
});
