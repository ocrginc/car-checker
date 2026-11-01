// Thin promise wrapper around IndexedDB. Stores: items, containers, photos, meta.
const DB_NAME = "car-checker";
const VERSION = 1;

let dbPromise;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      db.createObjectStore("items", { keyPath: "id" });
      db.createObjectStore("containers", { keyPath: "id" });
      db.createObjectStore("photos"); // keys: "<photoId>:thumb", "<photoId>:full"
      db.createObjectStore("meta");
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbPromise;
}

const wrap = r => new Promise((resolve, reject) => {
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});

export async function getAll(store) {
  const db = await open();
  return wrap(db.transaction(store).objectStore(store).getAll());
}

export async function get(store, key) {
  const db = await open();
  return wrap(db.transaction(store).objectStore(store).get(key));
}

export async function getMany(store, keys) {
  const db = await open();
  const s = db.transaction(store).objectStore(store);
  return Promise.all(keys.map(k => wrap(s.get(k))));
}

// Runs fn(stores) synchronously inside one transaction and resolves when it commits,
// so an item and its photos are always saved or dropped together.
export async function write(names, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(names, "readwrite");
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
    fn(Object.fromEntries(names.map(n => [n, t.objectStore(n)])));
  });
}
