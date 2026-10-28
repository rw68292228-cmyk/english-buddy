// 流程與事件：認字（影相 → AI 認 → 你改 → 學習）、教字（字樣、整頁範例）、字庫、設定。

import * as store from "./store.js";
import * as img from "./image.js";
import { ask, setModelFallbackHandler } from "./ai.js";
import {
  UNSURE_OPEN,
  UNSURE_CLOSE,
  recognizeIntro,
  exampleIntro,
  exampleCaption,
  sheetIntro,
  targetIntro,
  reviewText,
} from "./prompts.js";
import { findCorrections } from "./diff.js";

const MAX_EXAMPLES = 3; // 每次認字參考幾多個整頁範例（Groq 每次最多 5 張圖）
const MAX_SHEET = 48; // 參考表最多幾多個字樣
const PER_LABEL = 2; // 每個字最多放幾個字樣

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

let settings = store.loadSettings();

// ===== 小工具 =====
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 5000);
}

// 將 API 錯誤轉做易明嘅中文
function friendlyError(e) {
  const msg = e.message || String(e);
  if (/^(400|401)/.test(msg) && /key/i.test(msg)) return "API key 唔啱，請去「設定」檢查";
  if (/^429/.test(msg)) return "用晒呢段時間嘅免費額度，等一陣再試";
  if (/^413/.test(msg)) return "相片太大，試吓影近啲或者裁細啲";
  if (/Failed to fetch|NetworkError/i.test(msg)) return "連唔到網絡，請檢查網絡再試";
  return msg.slice(0, 300);
}

function showTab(name) {
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".tab").forEach((s) => (s.hidden = s.id !== `tab-${name}`));
  if (name === "library") renderLibrary();
  if (name === "teach") renderTeach();
  if (name === "read") $("need-key").hidden = !!store.activeKey(settings);
}

function drawTo(canvas, src) {
  canvas.width = src.width;
  canvas.height = src.height;
  canvas.getContext("2d").drawImage(src, 0, 0);
}

const byNewest = (a, b) => b.created - a.created;

// ===== 認字 =====
let readImage = null; // 原相（canvas）
let aiText = ""; // AI 讀到嘅（冇不確定標記）
let learned = false;

async function onReadFile(e) {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  readImage = await img.loadImage(file, 2000);
  drawTo($("read-canvas"), readImage);
  $("read-preview").hidden = false;
  $("read-result").hidden = true;
  $("read-status").textContent = "相片唔正就撳「轉 90°」，然後撳「認字」。";
}

// 揀參考字樣：之前認錯過嘅字優先，然後係唔肯定嘅字，再到草稿出現過嘅字
function pickGlyphs(glyphs, draft, confusions) {
  const byLabel = new Map();
  for (const g of [...glyphs].sort(byNewest)) {
    if (!byLabel.has(g.label)) byLabel.set(g.label, []);
    if (byLabel.get(g.label).length < PER_LABEL) byLabel.get(g.label).push(g);
  }
  const lower = draft.toLowerCase();
  const unsure = (draft.match(new RegExp(`${UNSURE_OPEN}[^${UNSURE_CLOSE}]*${UNSURE_CLOSE}`, "g")) || []).join("");
  const appears = (label) => (/^[a-z]+$/i.test(label) ? lower.includes(label.toLowerCase()) : draft.includes(label));

  const ordered = [];
  const push = (label) => byLabel.has(label) && !ordered.includes(label) && ordered.push(label);
  for (const c of confusions) if (draft.includes(c.misread)) push(c.written);
  for (const label of byLabel.keys()) if (unsure.includes(label)) push(label);
  for (const label of byLabel.keys()) if (appears(label)) push(label);

  return ordered.flatMap((l) => byLabel.get(l)).slice(0, MAX_SHEET);
}

async function recognize() {
  if (!readImage) return;
  if (!store.activeKey(settings)) {
    toast("請先去「設定」輸入 API key");
    return showTab("settings");
  }
  const btn = $("read-go");
  btn.disabled = true;
  const status = $("read-status");
  try {
    const photo = img.toJpeg(img.scaleDown(readImage, 1600));
    const confusions = store.topConfusions(store.loadData());
    const examples = (await store.all("examples")).sort(byNewest).slice(0, MAX_EXAMPLES);

    const parts = [{ text: recognizeIntro(confusions) }];
    if (examples.length) {
      parts.push({ text: exampleIntro });
      for (const ex of examples) parts.push({ image: ex.image }, { text: exampleCaption(ex.text) });
    }
    parts.push({ text: targetIntro }, { image: photo });

    status.textContent = `⏳ 認緊字…（參考 ${examples.length} 個範例、${confusions.length} 個認錯記錄）`;
    let draft = await ask(settings, parts);

    if (settings.twoPass) {
      const picked = pickGlyphs(await store.all("glyphs"), draft, confusions);
      if (picked.length) {
        status.textContent = `⏳ 用你教過嘅 ${picked.length} 個字樣再對一次…`;
        const sheet = await img.buildSheet(picked);
        draft = await ask(settings, [...parts, { text: sheetIntro }, { image: sheet }, { text: reviewText(draft) }]);
      }
    }

    showResult(draft);
    status.textContent = "";
  } catch (e) {
    status.textContent = `❌ ${friendlyError(e)}`;
  } finally {
    btn.disabled = false;
  }
}

function showResult(text) {
  const parts = text.split(new RegExp(`${UNSURE_OPEN}([^${UNSURE_CLOSE}]*)${UNSURE_CLOSE}`));
  $("read-marked").innerHTML = parts.map((p, i) => (i % 2 ? `<mark>${esc(p)}</mark>` : esc(p))).join("");
  aiText = parts.join("");
  $("read-text").value = aiText;
  $("read-learned").textContent = "";
  $("read-learn").disabled = false;
  learned = false;
  $("read-result").hidden = false;
  $("read-result").scrollIntoView({ behavior: "smooth" });
}

async function learnFromFix() {
  if (learned) return;
  const fixed = $("read-text").value.trim();
  if (!fixed) return toast("文字係空嘅");
  const pairs = findCorrections(aiText, fixed);
  const d = store.loadData();
  store.addConfusions(d, pairs);
  for (const { written } of pairs) if (!d.todo.includes(written)) d.todo.unshift(written);
  d.todo = d.todo.slice(0, 40);
  store.saveData(d);

  if ($("read-keep").checked) {
    await store.add("examples", { image: img.toJpeg(img.scaleDown(readImage, 1024), 0.8), text: fixed });
  }
  learned = true;
  $("read-learn").disabled = true;

  const out = $("read-learned");
  if (!pairs.length) {
    out.innerHTML = `🎉 冇改到字${$("read-keep").checked ? "，已存做範例" : ""}。`;
    return;
  }
  const list = pairs.map((p) => `<b>${esc(p.written)}</b>（讀錯做 ${esc(p.misread)}）`).join("、");
  out.innerHTML =
    `🧠 記低咗 ${pairs.length} 個認錯：${list}。下次會提醒 AI。` +
    `<button type="button" class="btn small" data-goto="teach">✍️ 去教呢啲字（更準）</button>`;
}

// ===== 教字：字樣 =====
function setMode(m) {
  document.querySelectorAll("[data-mode]").forEach((b) => b.classList.toggle("active", b.dataset.mode === m));
  $("mode-pad").hidden = m !== "pad";
  $("mode-photo").hidden = m !== "photo";
}

async function renderTeach() {
  const d = store.loadData();
  $("todo-box").hidden = !d.todo.length;
  $("todo").innerHTML = d.todo.map((t) => `<button type="button" class="chip" data-todo="${esc(t)}">${esc(t)}</button>`).join("");
  const recent = (await store.all("glyphs")).sort(byNewest).slice(0, 16);
  $("teach-recent").innerHTML = recent.map(glyphHtml).join("");
}

const glyphHtml = (g) =>
  `<button type="button" class="glyph" data-glyph="${g.id}" title="撳一下刪除"><img src="${esc(g.image)}" alt=""><b>${esc(g.label)}</b></button>`;

function currentLabel() {
  const label = $("glyph-label").value.trim();
  if (!label) {
    toast("請先輸入呢個係咩字");
    $("glyph-label").focus();
  }
  return label;
}

async function saveGlyph(label, image) {
  await store.add("glyphs", { label, image });
  const d = store.loadData();
  d.todo = d.todo.filter((t) => t !== label);
  store.saveData(d);
  const count = (await store.all("glyphs")).filter((g) => g.label === label).length;
  toast(`已儲存「${label}」（共 ${count} 個字樣）`);
  renderTeach();
}

// --- 手寫板 ---
const pad = $("pad");
const padCtx = pad.getContext("2d");
let drawing = false;

function clearPad() {
  padCtx.fillStyle = "#fff";
  padCtx.fillRect(0, 0, pad.width, pad.height);
}

function padPoint(e) {
  const r = pad.getBoundingClientRect();
  return [((e.clientX - r.left) * pad.width) / r.width, ((e.clientY - r.top) * pad.height) / r.height];
}

pad.addEventListener("pointerdown", (e) => {
  drawing = true;
  pad.setPointerCapture(e.pointerId);
  padCtx.strokeStyle = "#111";
  padCtx.lineWidth = 16;
  padCtx.lineCap = padCtx.lineJoin = "round";
  padCtx.beginPath();
  padCtx.moveTo(...padPoint(e));
  padCtx.lineTo(...padPoint(e));
  padCtx.stroke();
});
pad.addEventListener("pointermove", (e) => {
  if (!drawing) return;
  padCtx.lineTo(...padPoint(e));
  padCtx.stroke();
});
pad.addEventListener("pointerup", () => (drawing = false));
pad.addEventListener("pointercancel", () => (drawing = false));

// 搵墨水範圍，裁走白邊
function inkBounds(canvas) {
  const { data, width, height } = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (data[(y * width + x) * 4] < 200) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) return null;
  const m = 12;
  return { x: Math.max(0, x0 - m), y: Math.max(0, y0 - m), w: Math.min(width, x1 + m) - Math.max(0, x0 - m), h: Math.min(height, y1 + m) - Math.max(0, y0 - m) };
}

async function savePad() {
  const label = currentLabel();
  if (!label) return;
  const box = inkBounds(pad);
  if (!box) return toast("手寫板係空嘅");
  await saveGlyph(label, img.normalizeGlyph(img.crop(pad, box)));
  clearPad();
}

// --- 由相框選 ---
const cropCanvas = $("crop-canvas");
let cropSource = null;
let cropRect = null;
let cropStart = null;

function cropPoint(e) {
  const r = cropCanvas.getBoundingClientRect();
  return [((e.clientX - r.left) * cropCanvas.width) / r.width, ((e.clientY - r.top) * cropCanvas.height) / r.height];
}

function drawCrop() {
  const ctx = cropCanvas.getContext("2d");
  ctx.drawImage(cropSource, 0, 0);
  if (!cropRect) return;
  const { x, y, w, h } = cropRect;
  ctx.fillStyle = "rgba(0,0,0,.35)";
  ctx.fillRect(0, 0, cropCanvas.width, y);
  ctx.fillRect(0, y + h, cropCanvas.width, cropCanvas.height - y - h);
  ctx.fillRect(0, y, x, h);
  ctx.fillRect(x + w, y, cropCanvas.width - x - w, h);
  ctx.strokeStyle = "#f5b83d";
  ctx.lineWidth = Math.max(2, cropCanvas.width / 300);
  ctx.strokeRect(x, y, w, h);
}

async function onCropFile(e) {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  cropSource = await img.loadImage(file, 2000);
  cropCanvas.width = cropSource.width;
  cropCanvas.height = cropSource.height;
  cropRect = null;
  drawCrop();
  $("crop-area").hidden = false;
}

cropCanvas.addEventListener("pointerdown", (e) => {
  cropCanvas.setPointerCapture(e.pointerId);
  cropStart = cropPoint(e);
  cropRect = null;
});
cropCanvas.addEventListener("pointermove", (e) => {
  if (!cropStart) return;
  const [x, y] = cropPoint(e);
  const [sx, sy] = cropStart;
  cropRect = { x: Math.min(x, sx), y: Math.min(y, sy), w: Math.abs(x - sx), h: Math.abs(y - sy) };
  drawCrop();
});
cropCanvas.addEventListener("pointerup", () => (cropStart = null));
cropCanvas.addEventListener("pointercancel", () => (cropStart = null));

async function saveCrop() {
  const label = currentLabel();
  if (!label) return;
  if (!cropRect || cropRect.w < 8 || cropRect.h < 8) return toast("請喺相上拖一個框，框住個字");
  await saveGlyph(label, img.normalizeGlyph(img.crop(cropSource, cropRect)));
  cropRect = null;
  drawCrop();
  $("glyph-label").value = "";
}

// ===== 教字：整頁範例 =====
let exImage = null;

async function onExFile(e) {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  exImage = await img.loadImage(file, 1024);
  drawTo($("ex-canvas"), exImage);
  $("ex-area").hidden = false;
}

async function saveExample() {
  const text = $("ex-text").value.trim();
  if (!exImage) return;
  if (!text) return toast("請打返相入面寫咗嘅文字");
  await store.add("examples", { image: img.toJpeg(exImage, 0.8), text });
  exImage = null;
  $("ex-text").value = "";
  $("ex-area").hidden = true;
  toast("已儲存範例 👍");
}

// ===== 字庫 =====
async function renderLibrary() {
  const [glyphs, examples] = await Promise.all([store.all("glyphs"), store.all("examples")]);
  const d = store.loadData();
  const labels = new Set(glyphs.map((g) => g.label));
  const confusions = store.topConfusions(d, 1000);
  $("lib-stats").innerHTML =
    `✍️ 已教 <b>${labels.size}</b> 個字（${glyphs.length} 個字樣）<br>` +
    `📄 整頁範例 <b>${examples.length}</b> 個<br>` +
    `🧠 認錯記錄 <b>${confusions.length}</b> 個`;

  glyphs.sort((a, b) => a.label.localeCompare(b.label, "zh-Hant") || byNewest(a, b));
  $("lib-glyphs").innerHTML = glyphs.map(glyphHtml).join("") || `<p class="hint">未教任何字。</p>`;

  $("lib-examples").innerHTML =
    examples
      .sort(byNewest)
      .map(
        (ex) =>
          `<div class="example"><img src="${esc(ex.image)}" alt=""><p>${esc(ex.text)}</p>` +
          `<button type="button" class="x" data-example="${ex.id}">✕</button></div>`
      )
      .join("") || `<p class="hint">未有範例。喺「教字」影一段抄寫，或者認字後撳「改好，儲存學習」。</p>`;

  $("lib-confusions").innerHTML =
    confusions
      .map(
        (c) =>
          `<li><span><b>${esc(c.written)}</b> ← ${esc(c.misread)}　<span class="hint">${c.count} 次</span></span>` +
          `<button type="button" class="x" data-confusion="${esc(`${c.misread}→${c.written}`)}">✕</button></li>`
      )
      .join("") || `<li class="hint">未有記錄。</li>`;
}

async function exportBackup() {
  const blob = new Blob([JSON.stringify(await store.exportAll())], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `my-handwriting-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importBackup(e) {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file || !confirm("匯入會取代而家所有字樣、範例同記錄，確定？")) return;
  try {
    await store.importAll(JSON.parse(await file.text()));
    toast("匯入完成");
    renderLibrary();
  } catch (err) {
    toast(`匯入失敗：${err.message}`);
  }
}

// ===== 設定 =====
function setProvider(p) {
  settings.provider = p;
  document.querySelectorAll("[data-provider]").forEach((b) => b.classList.toggle("active", b.dataset.provider === p));
  $("gemini-box").hidden = p !== "gemini";
  $("groq-box").hidden = p !== "groq";
}

function fillSettings() {
  setProvider(settings.provider);
  $("gemini-key").value = settings.geminiKey;
  $("gemini-model").value = settings.geminiModel;
  $("groq-key").value = settings.groqKey;
  $("groq-model").value = settings.groqModel;
  $("two-pass").checked = settings.twoPass;
}

function readSettings() {
  settings.geminiKey = $("gemini-key").value.trim();
  settings.geminiModel = $("gemini-model").value.trim() || store.DEFAULT_GEMINI_MODEL;
  settings.groqKey = $("groq-key").value.trim();
  settings.groqModel = $("groq-model").value.trim() || store.DEFAULT_GROQ_MODEL;
  settings.twoPass = $("two-pass").checked;
  store.saveSettings(settings);
}

// 用一張即場畫嘅測試圖試吓條 key 同模型
async function testKey() {
  readSettings();
  const out = $("test-result");
  if (!store.activeKey(settings)) return (out.textContent = "請先輸入 API key");
  out.textContent = "⏳ 測試緊…";
  const c = img.makeCanvas(360, 120);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = "#111";
  ctx.font = '48px system-ui, "PingFang HK", sans-serif';
  ctx.fillText("Hello 你好", 24, 76);
  try {
    const text = await ask(settings, [{ text: "Transcribe the text in this image. Output only the text." }, { image: img.toJpeg(c) }]);
    const model = settings.provider === "groq" ? settings.groqModel : settings.geminiModel;
    out.textContent = `✅ 用得！（${model}）AI 讀到：「${text}」`;
  } catch (e) {
    out.textContent = `❌ ${friendlyError(e)}`;
  }
}

setModelFallbackHandler((field, model) => {
  settings[field] = model;
  store.saveSettings(settings);
  fillSettings();
  toast(`原本嘅模型用唔到，已自動改用 ${model}`);
});

// ===== 事件 =====
document.addEventListener("click", async (e) => {
  const t = e.target.closest("button, a");
  if (!t) return;
  if (t.dataset.tab) return showTab(t.dataset.tab);
  if (t.dataset.goto) {
    e.preventDefault();
    return showTab(t.dataset.goto);
  }
  if (t.dataset.mode) return setMode(t.dataset.mode);
  if (t.dataset.provider) return setProvider(t.dataset.provider);
  if (t.dataset.todo) {
    $("glyph-label").value = t.dataset.todo;
    return toast(`而家教「${t.dataset.todo}」：寫好或者框好就撳儲存`);
  }
  if (t.dataset.glyph) {
    if (!confirm("刪除呢個字樣？")) return;
    await store.remove("glyphs", Number(t.dataset.glyph));
    return t.closest("#lib-glyphs") ? renderLibrary() : renderTeach();
  }
  if (t.dataset.example) {
    if (!confirm("刪除呢個範例？")) return;
    await store.remove("examples", Number(t.dataset.example));
    return renderLibrary();
  }
  if (t.dataset.confusion) {
    const d = store.loadData();
    delete d.confusions[t.dataset.confusion];
    store.saveData(d);
    return renderLibrary();
  }
});

$("read-camera").addEventListener("change", onReadFile);
$("read-file").addEventListener("change", onReadFile);
$("read-rotate").addEventListener("click", () => {
  readImage = img.rotate(readImage);
  drawTo($("read-canvas"), readImage);
});
$("read-go").addEventListener("click", recognize);
$("read-copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("read-text").value);
    toast("已複製");
  } catch {
    $("read-text").select();
    toast("請長按選取再複製");
  }
});
$("read-learn").addEventListener("click", learnFromFix);

$("pad-clear").addEventListener("click", clearPad);
$("pad-save").addEventListener("click", savePad);
$("crop-camera").addEventListener("change", onCropFile);
$("crop-file").addEventListener("change", onCropFile);
$("crop-save").addEventListener("click", saveCrop);

$("ex-camera").addEventListener("change", onExFile);
$("ex-file").addEventListener("change", onExFile);
$("ex-rotate").addEventListener("click", () => {
  exImage = img.rotate(exImage);
  drawTo($("ex-canvas"), exImage);
});
$("ex-save").addEventListener("click", saveExample);

$("export").addEventListener("click", exportBackup);
$("import").addEventListener("change", importBackup);

$("save-settings").addEventListener("click", () => {
  readSettings();
  toast("已儲存");
  $("need-key").hidden = !!store.activeKey(settings);
});
$("test-key").addEventListener("click", testKey);

// ===== 開始 =====
clearPad();
fillSettings();
showTab(store.activeKey(settings) ? "read" : "settings");
