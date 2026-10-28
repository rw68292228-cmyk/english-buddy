// 資料儲存：設定同認錯記錄存 localStorage；字樣同整頁範例（圖片，比較大）存 IndexedDB。全部只留喺呢部機。

const SETTINGS_KEY = "handwriting-settings";
const DATA_KEY = "handwriting-data";
const BUDDY_SETTINGS_KEY = "english-buddy-settings"; // 同一個網址嘅 English Buddy，可以借佢條 Groq key

export const DEFAULT_GEMINI_MODEL = "gemini-flash-latest";
export const DEFAULT_GROQ_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";

// ===== 設定 =====
export function loadSettings() {
  let s = {};
  try {
    s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
  } catch {}
  if (!s.groqKey) {
    try {
      s.groqKey = JSON.parse(localStorage.getItem(BUDDY_SETTINGS_KEY) || "{}").apiKey || "";
    } catch {}
  }
  return {
    provider: "gemini",
    geminiKey: "",
    geminiModel: DEFAULT_GEMINI_MODEL,
    groqModel: DEFAULT_GROQ_MODEL,
    twoPass: true,
    ...s,
  };
}

export function saveSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

export const activeKey = (s) => (s.provider === "groq" ? s.groqKey : s.geminiKey);

// ===== 認錯記錄：「你寫嘅 written，AI 讀咗做 misread」 =====
// confusions: { "misread→written": { written, misread, count, last } }
// todo: 改正過、未教字樣嘅字
export function loadData() {
  try {
    return { confusions: {}, todo: [], ...JSON.parse(localStorage.getItem(DATA_KEY) || "{}") };
  } catch {
    return { confusions: {}, todo: [] };
  }
}

export function saveData(d) {
  localStorage.setItem(DATA_KEY, JSON.stringify(d));
}

export function addConfusions(d, pairs) {
  const now = Date.now();
  for (const { written, misread } of pairs) {
    const k = `${misread}→${written}`;
    const c = d.confusions[k] || { written, misread, count: 0 };
    c.count++;
    c.last = now;
    d.confusions[k] = c;
  }
}

// 最常錯、最近錯嘅排先
export function topConfusions(d, n = 40) {
  return Object.values(d.confusions)
    .sort((a, b) => b.count - a.count || b.last - a.last)
    .slice(0, n);
}

// ===== IndexedDB =====
// glyphs: { id, label, image(dataURL), created }   單字字樣
// examples: { id, image(dataURL), text, created }  整頁（或一段）手寫 + 正確文字
let dbPromise;
function db() {
  dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open("handwriting", 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("glyphs", { keyPath: "id", autoIncrement: true });
      req.result.createObjectStore("examples", { keyPath: "id", autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run(storeName, mode, fn) {
  const tx = (await db()).transaction(storeName, mode);
  const req = fn(tx.objectStore(storeName));
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}

export const all = (name) => run(name, "readonly", (s) => s.getAll());
export const add = (name, item) => run(name, "readwrite", (s) => s.add({ ...item, created: Date.now() }));
export const remove = (name, id) => run(name, "readwrite", (s) => s.delete(id));
export const clear = (name) => run(name, "readwrite", (s) => s.clear());

// ===== 備份 =====
export async function exportAll() {
  return {
    app: "handwriting",
    version: 1,
    data: loadData(),
    glyphs: await all("glyphs"),
    examples: await all("examples"),
  };
}

export async function importAll(backup) {
  if (backup?.app !== "handwriting") throw new Error("唔係呢個 app 嘅備份檔");
  saveData({ confusions: {}, todo: [], ...backup.data });
  await clear("glyphs");
  await clear("examples");
  for (const g of backup.glyphs || []) await run("glyphs", "readwrite", (s) => s.add(g));
  for (const e of backup.examples || []) await run("examples", "readwrite", (s) => s.add(e));
}
