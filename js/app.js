// English Buddy 主程式：熱身複習 → 每日 10 分鐘傾偈（🆘 記低講唔出）→ 總結 → 跟讀 → 打卡。

import * as ai from "./ai.js";
import * as store from "./store.js";
import { chatSystemPrompt, parseJson, suggestPrompt, summaryPrompt, tipPrompt, topicPrompt } from "./prompts.js";
import { compareWords } from "./shadowing.js";

const SESSION_MINUTES = 10;
const WRAP_UP_MINUTES = 8; // 傾到呢個時間，AI 會開始自然收尾

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

let settings = store.loadSettings();
let sess = null; // 進行中的傾偈
let recorder = null; // 錄緊音的話唔係 null
let busy = false;
let phrases = [];
let pidx = 0;

// ===== 小工具 =====
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 5000);
}

function friendlyError(e) {
  const m = String(e?.message || e);
  if (m.startsWith("401")) return "API key 唔啱，去「設定」檢查下。";
  if (m.startsWith("429")) return "Groq 免費額度暫時用晒，等一陣再試。";
  if (m.includes("Failed to fetch") || m.includes("NetworkError")) return "連唔到網絡，檢查下再試。";
  if (m.includes("Permission") || m.includes("NotAllowed")) return "未容許用咪，請喺瀏覽器設定容許。";
  return m.slice(0, 200);
}

function requireKey() {
  if (settings.apiKey) return true;
  toast("請先喺「設定」輸入 Groq API key");
  showTab("settings");
  return false;
}

const minutes = () => (Date.now() - sess.start) / 60000;

// ===== 畫面切換 =====
function showTab(name) {
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  for (const t of ["practice", "records", "settings"]) $(`tab-${t}`).hidden = t !== name;
  if (name === "records") renderRecords();
  if (name === "settings") renderSettings();
}

function showView(name) {
  for (const v of ["home", "chat", "summary"]) $(v).hidden = v !== name;
}

function renderDash() {
  const d = store.load();
  const badges = store.earnedBadges(d).join(" ") || "完成第一次練習就有徽章！";
  $("dash").innerHTML =
    `<div class="streak">🔥 連續 ${store.currentStreak(d)} 日 · ${store.doneToday(d) ? "✅ 今日已完成" : "⏳ 今日未練"}</div>` +
    `<div class="badges">最長紀錄 ${store.longestStreak(d)} 日 · ${esc(badges)}</div>`;
}

function renderTimer() {
  if (!sess) return;
  const m = minutes();
  $("timer").textContent =
    m < WRAP_UP_MINUTES ? `⏱️ ${Math.floor(m)} / ${SESSION_MINUTES} 分鐘` : "⏱️ 差唔多夠鐘，可以撳「結束並總結」🎉";
}

function addBubble(role, html) {
  const div = document.createElement("div");
  div.className = `bubble ${role}`;
  div.innerHTML = html;
  const box = $("messages");
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
  return div;
}

function onSpeakError(msg) {
  toast(`🔈 ${msg}`);
}

function say(text) {
  ai.speak(text, settings, onSpeakError);
}

// Buddy 講嘢：顯示泡泡（附 🔊 重播掣）並朗讀
function addBuddy(text) {
  const div = addBubble("ai", esc(text));
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "replay";
  btn.textContent = "🔊";
  btn.setAttribute("aria-label", "重播");
  btn.addEventListener("click", () => say(text));
  div.appendChild(btn);
  say(text);
}

function setMic(state) {
  const b = $("mic-btn");
  b.classList.toggle("recording", state === "rec");
  b.disabled = state === "busy";
  b.textContent = { rec: "⏹️", busy: "⏳", idle: "🎤" }[state];
  $("mic-label").textContent = { rec: "講完撳一下送出", busy: "Buddy 諗緊…", idle: "撳一下開始講" }[state];
}

// ===== 揀話題 =====
// 現成話題：唔使用 AI 額度；en 會交俾 AI 出題
const PRESET_TOPICS = [
  { zh: "☕ 日常生活", en: "daily life and routines" },
  { zh: "✈️ 旅遊", en: "travel experiences and dream trips" },
  { zh: "🍜 美食", en: "food, restaurants and cooking" },
  { zh: "💼 工作", en: "work and career" },
  { zh: "🎬 電影劇集", en: "movies and TV shows" },
  { zh: "🎵 音樂", en: "music" },
  { zh: "🛍️ 購物", en: "shopping" },
  { zh: "🏃 運動健康", en: "sports, exercise and health" },
  { zh: "👨‍👩‍👧 家人朋友", en: "family and friends" },
  { zh: "🏙️ 香港生活", en: "life in Hong Kong" },
  { zh: "🛫 機場酒店（角色扮演）", en: "role-play: checking in at an airport and a hotel abroad" },
  { zh: "🍽️ 餐廳點餐（角色扮演）", en: "role-play: ordering food at a restaurant abroad" },
  { zh: "👔 求職面試（角色扮演）", en: "role-play: a job interview in English" },
];
const RANDOM_TOPIC = { zh: "🎲 Buddy 揀", en: null };

let chosenTopic = RANDOM_TOPIC; // 而家揀緊的話題
let suggestedTopics = []; // ✨ Buddy 建議的話題

function renderChips() {
  const custom = $("custom-topic").value.trim();
  const chips = [RANDOM_TOPIC, ...suggestedTopics, ...PRESET_TOPICS];
  const box = $("topic-chips");
  box.innerHTML = "";
  for (const t of chips) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    if (suggestedTopics.includes(t)) b.classList.add("suggested");
    if (!custom && t === chosenTopic) b.classList.add("active");
    b.textContent = t.zh;
    b.addEventListener("click", () => {
      chosenTopic = t;
      $("custom-topic").value = "";
      renderChips();
    });
    box.appendChild(b);
  }
}

async function suggestTopics() {
  if (busy || !requireKey()) return;
  const btn = $("suggest-btn");
  btn.disabled = true;
  btn.textContent = "⏳ Buddy 諗緊…";
  try {
    const data = store.load();
    const recent = data.sessions.slice(-10).map((s) => s.topic);
    const raw = await ai.chat(settings, [{ role: "user", content: suggestPrompt(data.profile, recent) }], {
      maxTokens: 250,
      temperature: 1,
    });
    const topics = (parseJson(raw)?.topics || []).filter((t) => t?.topic).slice(0, 3);
    if (!topics.length) throw new Error("Buddy 諗唔到，再撳一次？");
    suggestedTopics = topics.map((t) => ({ zh: `✨ ${t.topic_zh || t.topic}`, en: t.topic }));
    chosenTopic = suggestedTopics[0];
    $("custom-topic").value = "";
    renderChips();
  } catch (e) {
    toast(friendlyError(e));
  } finally {
    btn.disabled = false;
    btn.textContent = "✨ 換一批 Buddy 建議";
  }
}

// ===== 傾偈 =====
async function startSession() {
  if (busy || !requireKey()) return;
  ai.unlockSpeech();
  busy = true;
  const btn = $("start-btn");
  btn.disabled = true;
  btn.textContent = "⏳ 準備緊今日話題…";
  // 自己打的話題優先，其次係揀咗的話題；Buddy 揀就係 null
  const custom = $("custom-topic").value.trim();
  const requested = custom || chosenTopic.en;
  const requestedLabel = custom || chosenTopic.zh.replace(/^\S+\s/, "");
  try {
    const data = store.load();
    const recent = data.sessions.slice(-7).map((s) => s.topic);
    let j = {};
    try {
      const raw = await ai.chat(settings, [{ role: "user", content: topicPrompt(data.profile, recent, requested) }], {
        maxTokens: 200,
        temperature: 0.9,
      });
      j = parseJson(raw) || {};
    } catch (e) {
      if (/^(401|429)/.test(e.message)) throw e;
      console.warn("出題失敗", e);
    }
    const opener =
      j.opener ||
      (requested
        ? "Hey, good to see you! I heard you want to chat about this today. Tell me a little about it!"
        : "Hey, good to see you! Got any fun plans for the weekend?");
    sess = {
      start: Date.now(),
      topic: j.topic || requested || "Plans for the weekend",
      profile: data.profile,
      messages: [{ role: "assistant", content: opener }],
      userTurns: 0,
      gaps: [], // 🆘 講唔出嘅位
    };
    $("gap-box").hidden = true;
    $("topic").textContent = `今日話題：${j.topic_zh || (requested ? requestedLabel : "週末計劃")}`;
    $("messages").innerHTML = "";
    $("tips-toggle").checked = settings.showTips;
    setMic("idle");
    showView("chat");
    addBuddy(opener);
    renderTimer();
  } catch (e) {
    toast(friendlyError(e));
  } finally {
    busy = false;
    btn.disabled = false;
    btn.textContent = "▶️ 開始今日 10 分鐘傾偈";
  }
}

async function quickTip(previousAi, userText) {
  try {
    const raw = await ai.chat(settings, [{ role: "user", content: tipPrompt(previousAi, userText) }], {
      maxTokens: 150,
      temperature: 0.2,
    });
    const j = parseJson(raw) || {};
    if (j.ok === true || !j.better) return "";
    return `<div class="tip">💡 <b>${esc(j.better)}</b>${j.note ? `<br>${esc(j.note)}` : ""}</div>`;
  } catch (e) {
    console.warn("提示失敗", e);
    return "";
  }
}

async function respond(userText, viaVoice) {
  const userDiv = addBubble("me", (viaVoice ? "🎤 " : "") + esc(userText));
  const previousAi = sess.messages.at(-1)?.content || "";
  const system = chatSystemPrompt(sess.profile, sess.topic, minutes() >= WRAP_UP_MINUTES);
  const messages = [{ role: "system", content: system }, ...sess.messages.slice(-20), { role: "user", content: userText }];

  // 💡 提示同 AI 回應同時進行，提示返嚟就貼喺你句說話下面
  if ($("tips-toggle").checked) {
    quickTip(previousAi, userText).then((html) => html && userDiv.insertAdjacentHTML("beforeend", html));
  }
  const reply = await ai.chat(settings, messages, { maxTokens: 200 });
  sess.messages.push({ role: "user", content: userText }, { role: "assistant", content: reply });
  sess.userTurns++;
  addBuddy(reply);
  renderTimer();
}

async function toggleMic() {
  if (!recorder) {
    if (busy) return;
    ai.stopSpeaking();
    try {
      recorder = await ai.startRecording();
      setMic("rec");
    } catch (e) {
      recorder = null;
      toast(`開唔到咪：${friendlyError(e)}`);
    }
    return;
  }
  const rec = recorder;
  recorder = null;
  busy = true;
  setMic("busy");
  try {
    const blob = await rec.stop();
    if (blob.size < 2000) throw new Error("錄音太短，撳一下開始，講完再撳一下。");
    const text = await ai.transcribe(settings.apiKey, blob);
    if (!text) throw new Error("聽唔到你講嘢，再試一次？");
    await respond(text, true);
  } catch (e) {
    toast(friendlyError(e));
  } finally {
    busy = false;
    setMic("idle");
  }
}

async function sendText(e) {
  e.preventDefault();
  const input = $("text-input");
  const text = input.value.trim();
  if (!text || busy || !sess) return;
  input.value = "";
  busy = true;
  setMic("busy");
  try {
    await respond(text, false);
  } catch (err) {
    toast(friendlyError(err));
  } finally {
    busy = false;
    setMic("idle");
  }
}

// ===== 講唔出 =====
// 只係記低，唔使 AI、唔打斷對話；總結先教點講
function toggleGapBox() {
  const box = $("gap-box");
  box.hidden = !box.hidden;
  if (!box.hidden) $("gap-input").focus();
}

function saveGap(e) {
  e.preventDefault();
  const input = $("gap-input");
  const zh = input.value.trim();
  if (!zh || !sess) return;
  sess.gaps.push({ zh, context: sess.messages.at(-1)?.content || "" });
  addBubble("gap", `🆘 記低咗：${esc(zh)}`);
  input.value = "";
  $("gap-box").hidden = true;
  toast("✅ 記低咗，總結會教你點講。繼續傾，試下兜路講！");
}

// ===== 總結 =====
function summaryHtml(j, raw, newBadges, gaps) {
  if (!j) return `<h2>🎉 今日總結</h2><p>${esc(raw)}</p>`;
  const parts = [`<h2>🎉 今日總結</h2>`, `<p>👏 ${esc(j.praise || "做得好！")}</p>`];
  if (newBadges.length) parts.push(`<p>🎖️ <b>新徽章：</b>${esc(newBadges.join(" "))}</p>`);
  const list = (items, fn) => `<ul>${items.map(fn).join("")}</ul>`;
  if (gaps.length) {
    parts.push(`<h3>🧩 你想講但講唔出嘅嘢</h3>`);
    parts.push(
      list(
        gaps,
        (g) => `<li>${esc(g.zh)}<br>✅ <b>${esc(g.en)}</b>${g.simple ? `<br>🪜 簡單啲：${esc(g.simple)}` : ""}</li>`
      )
    );
    parts.push(`<p class="hint">下面跟讀會由呢幾句開始，每句大聲講 3 次 💪</p>`);
  }
  if (j.corrections?.length) {
    parts.push(`<h3>✍️ 可以講得更好</h3>`);
    parts.push(
      list(j.corrections, (c) => `<li>❌ ${esc(c.original)}<br>✅ <b>${esc(c.better)}</b><br>💡 ${esc(c.explain)}</li>`)
    );
  }
  if (j.pronunciation?.length) {
    parts.push(`<h3>🗣️ 發音留意</h3>`);
    parts.push(list(j.pronunciation, (p) => `<li><b>${esc(p.word)}</b>：${esc(p.tip)}</li>`));
  }
  if (j.phrases?.length) {
    parts.push(`<h3>💬 今日實用句子</h3>`);
    parts.push(list(j.phrases, (p) => `<li><b>${esc(p.en)}</b> — ${esc(p.zh)}</li>`));
  }
  return parts.join("");
}

async function finish() {
  if (busy) return;
  if (!sess || sess.userTurns < 2) {
    toast("至少傾兩句先總結啦 😊");
    return;
  }
  busy = true;
  ai.stopSpeaking();
  const btn = $("end-btn");
  btn.disabled = true;
  btn.textContent = "⏳ 整緊總結…";
  try {
    const transcript = sess.messages
      .map((m) => `${m.role === "user" ? "Learner" : "Buddy"}: ${m.content}`)
      .join("\n");
    const raw = await ai.chat(settings, [{ role: "user", content: summaryPrompt(transcript, sess.gaps) }], {
      maxTokens: 1200 + 120 * sess.gaps.length,
      temperature: 0.3,
    });
    const j = parseJson(raw);
    const gaps = sess.gaps.length ? (j?.gaps || []).filter((g) => g && g.en) : [];
    const daily = (j?.phrases || []).filter((p) => p && p.en);
    // 講唔出嘅句子排頭，跟讀同熱身都優先練
    phrases = [...gaps.map((g) => ({ en: g.en, zh: g.zh || "", gap: true })), ...daily];
    pidx = 0;

    const data = store.load();
    const before = new Set(store.earnedBadges(data));
    store.addSession(data, sess.topic, minutes(), sess.userTurns, j?.new_facts || [], phrases);
    store.setReview(data, phrases.map((p) => ({ en: p.en, zh: p.zh || "", gap: !!p.gap })));
    store.save(data);
    const newBadges = store.earnedBadges(data).filter((b) => !before.has(b));

    $("summary-body").innerHTML = summaryHtml(j, raw, newBadges, gaps);
    renderPhrase();
    sess = null;
    renderDash();
    showView("summary");
    window.scrollTo(0, 0);
  } catch (e) {
    toast(`總結失敗：${friendlyError(e)}（可以再撳一次）`);
  } finally {
    busy = false;
    btn.disabled = false;
    btn.textContent = "🏁 結束並總結";
  }
}

// ===== 跟讀 =====
function renderPhrase() {
  $("shadow-result").innerHTML = "";
  if (!phrases.length) {
    $("phrase").innerHTML = `<p class="hint">今日冇跟讀句子。</p>`;
    return;
  }
  const p = phrases[pidx];
  $("phrase").innerHTML =
    `<p class="hint">第 ${pidx + 1}/${phrases.length} 句${p.gap ? " · 🧩 你講唔出嗰句" : ""}</p>` +
    `<p class="phrase-en">${esc(p.en)}</p><p>${esc(p.zh)}</p>`;
}

// 錄音掣：撳第一下開始錄，第二下停止、辨識，再交俾 onText
async function recordAndTranscribe(btn, idleLabel, onText) {
  if (!recorder) {
    ai.stopSpeaking();
    try {
      recorder = await ai.startRecording();
      btn.textContent = "⏹️ 講完撳一下";
      btn.classList.add("recording");
    } catch (e) {
      recorder = null;
      toast(`開唔到咪：${friendlyError(e)}`);
    }
    return;
  }
  const rec = recorder;
  recorder = null;
  btn.classList.remove("recording");
  btn.textContent = "⏳ 分析緊…";
  btn.disabled = true;
  try {
    onText(await ai.transcribe(settings.apiKey, await rec.stop()));
  } catch (e) {
    toast(friendlyError(e));
  } finally {
    btn.disabled = false;
    btn.textContent = idleLabel;
  }
}

function resultHtml(target, said) {
  const r = compareWords(target, said);
  return {
    r,
    html:
      `<h3>🎯 準確度 ${r.score}%</h3><p class="marked">${r.html}</p>` + `<p class="hint">辨識到：${esc(said)}</p>`,
  };
}

function toggleShadow() {
  if (!phrases.length) return;
  recordAndTranscribe($("shadow-btn"), "🎤 跟住讀", (said) => {
    const { r, html } = resultHtml(phrases[pidx].en, said);
    $("shadow-result").innerHTML =
      html + `<p>${r.missed.length ? "標示咗嘅字可能讀得唔清楚，撳「聽示範」再跟讀一次 💪" : "完美！🎉"}</p>`;
  });
}

// ===== 熱身複習：睇中文，用英文講返上次學嘅句子 =====
let reviewItems = null; // 進行中的熱身；null＝未開始或者冇嘢要溫
let ridx = 0;

function initReview() {
  const r = store.pendingReview(store.load());
  reviewItems = r ? r.items : null;
  ridx = 0;
  renderReview();
}

function renderReview() {
  $("review").hidden = !reviewItems;
  if (!reviewItems) return;
  const item = reviewItems[ridx];
  $("review-item").innerHTML =
    `<p class="hint">第 ${ridx + 1}/${reviewItems.length} 句 · 睇住中文，用英文講出嚟${item.gap ? " · 🧩 你上次講唔出嗰句" : ""}</p>` +
    `<p class="phrase-en">${esc(item.zh || "（冇中文提示）")}</p>`;
  $("review-result").innerHTML = "";
  $("review-next").textContent = ridx + 1 < reviewItems.length ? "➡️ 下一句" : "✅ 熱身完成";
}

function revealAnswer(extra = "") {
  const item = reviewItems[ridx];
  $("review-result").innerHTML = `${extra}<p>✅ <b>${esc(item.en)}</b></p>`;
  say(item.en);
}

function reviewSay() {
  if (!reviewItems || !requireKey()) return;
  ai.unlockSpeech();
  recordAndTranscribe($("review-say"), "🎤 用英文講出嚟", (said) => {
    revealAnswer(resultHtml(reviewItems[ridx].en, said).html);
  });
}

function reviewNext() {
  if (!reviewItems) return;
  if (ridx + 1 < reviewItems.length) {
    ridx++;
    renderReview();
    return;
  }
  const data = store.load();
  if (data.review) data.review.reviewedOn = store.todayHK();
  store.save(data);
  reviewItems = null;
  renderReview();
  toast("✅ 熱身完成！而家揀話題開始傾啦");
}

// ===== 我的紀錄 =====
function renderRecords() {
  const d = store.load();
  $("profile").value = d.profile.join("\n");
  $("history").innerHTML =
    d.sessions
      .slice(-14)
      .reverse()
      .map((s) => `<li>${esc(s.date)}｜${esc(s.topic)}｜${esc(s.minutes)} 分鐘</li>`)
      .join("") || "<li>未有紀錄</li>";
  $("learned").innerHTML =
    d.phrases
      .slice(-30)
      .reverse()
      .map((p) => `<li><b>${esc(p.en)}</b> — ${esc(p.zh)}</li>`)
      .join("") || "<li>未有紀錄</li>";
}

function saveProfile() {
  const d = store.load();
  d.profile = $("profile").value.split("\n").map((l) => l.trim()).filter(Boolean);
  store.save(d);
  toast("✅ 已儲存");
}

function exportData() {
  const blob = new Blob([JSON.stringify(store.load(), null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `english-buddy-backup-${store.todayHK()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importData(e) {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.sessions)) throw new Error("唔係 English Buddy 備份檔");
    if (!confirm("匯入會取代呢部機現有嘅紀錄，確定？")) return;
    store.save({ ...store.empty(), ...data });
    renderRecords();
    renderDash();
    toast("✅ 已匯入");
  } catch (err) {
    toast(`匯入失敗：${err.message}`);
  }
}

// ===== 設定 =====
function fillVoices() {
  const sel = $("voice");
  // Edge 會分幾次載入聲線；重建選單時保留使用者而家揀緊的，唔好跳返「自動揀」
  const current = sel.value || settings.voiceURI || "";
  sel.innerHTML =
    `<option value="">自動揀</option>` +
    ai
      .englishVoices()
      .map((v) => `<option value="${esc(v.voiceURI)}">${esc(v.name)} (${esc(v.lang)})</option>`)
      .join("");
  sel.value = current;
  if (sel.value !== current) sel.value = ""; // 揀過的聲線呢部機冇，就用自動揀
}

function showEngineOptions() {
  const orpheus = $("tts-engine").value === "orpheus";
  $("orpheus-opts").hidden = !orpheus;
  $("browser-voice-opts").hidden = orpheus;
}

function renderSettings() {
  $("api-key").value = settings.apiKey;
  $("model").value = settings.model;
  $("rate").value = settings.rate;
  $("rate-val").textContent = settings.rate;
  $("tips-default").checked = settings.showTips;
  $("tts-engine").value = settings.ttsEngine;
  $("orpheus-voice").innerHTML = ai.ORPHEUS_VOICES.map(([id, name]) => `<option value="${id}">${esc(name)}</option>`).join("");
  $("orpheus-voice").value = settings.orpheusVoice;
  $("tts-style").value = settings.ttsStyle;
  showEngineOptions();
  fillVoices();
}

function formSettings() {
  return {
    ...settings,
    apiKey: $("api-key").value.trim(),
    model: $("model").value.trim() || ai.DEFAULT_MODEL,
    ttsEngine: $("tts-engine").value,
    voiceURI: $("voice").value,
    orpheusVoice: $("orpheus-voice").value,
    ttsStyle: $("tts-style").value,
    rate: Number($("rate").value),
    showTips: $("tips-default").checked,
  };
}

function saveSettings() {
  settings = formSettings();
  store.saveSettings(settings);
  toast("✅ 設定已儲存");
}

// ===== 測試 =====
function testResult(html) {
  $("test-result").innerHTML = html;
}

async function testKey() {
  const s = formSettings();
  if (!s.apiKey) return testResult("❌ 請先喺上面輸入 API key");
  testResult("⏳ 連緊 Groq…");
  const t0 = performance.now();
  try {
    const reply = await ai.chat(s, [{ role: "user", content: "Reply with exactly: OK" }], { maxTokens: 5, temperature: 0 });
    const ms = Math.round(performance.now() - t0);
    // 如果自動換咗模型，輸入框已經更新，所以讀返輸入框
    testResult(`✅ API key 用得！模型 <b>${esc($("model").value)}</b> 回應：「${esc(reply)}」（${ms} 毫秒）`);
  } catch (e) {
    testResult(`❌ ${esc(friendlyError(e))}`);
  }
}

async function testMic() {
  const btn = $("test-mic");
  const s = formSettings();
  if (!recorder) {
    if (!s.apiKey) return testResult("❌ 請先喺上面輸入 API key");
    try {
      recorder = await ai.startRecording();
      btn.textContent = "⏹️ 講完撳一下";
      btn.classList.add("recording");
      testResult("🎤 錄緊音… 用英文講一句，例如 “Good morning, how are you?”");
    } catch (e) {
      recorder = null;
      testResult(`❌ 開唔到咪：${esc(friendlyError(e))}`);
    }
    return;
  }
  const rec = recorder;
  recorder = null;
  btn.classList.remove("recording");
  btn.textContent = "2️⃣ 測試咪同語音辨識";
  testResult("⏳ 辨識緊…");
  try {
    const blob = await rec.stop();
    const text = await ai.transcribe(s.apiKey, blob);
    testResult(text ? `✅ 咪同語音辨識用得！聽到：「${esc(text)}」` : "⚠️ 錄到音但聽唔到內容，講大聲啲再試？");
  } catch (e) {
    testResult(`❌ ${esc(friendlyError(e))}`);
  }
}

function testVoice() {
  if (!window.speechSynthesis) return testResult("❌ 呢個瀏覽器唔支援朗讀");
  ai.unlockSpeech();
  const s = formSettings();
  // 測試時一定重新試 Orpheus（例如啱啱同意咗條款）；網址變成可以撳的連結
  ai.speak(
    "Hi! I'm Buddy. If you can hear me, text to speech is working.",
    s,
    (msg) => testResult(`⚠️ ${esc(msg).replace(/(https:\/\/\S+?)(?=。|\s|$)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')}`),
    { retryOrpheus: true }
  );
  testResult(
    `🔊 用緊：<b>${esc(ai.describeVoice(s))}</b><br>` +
      (s.ttsEngine === "orpheus" ? "Orpheus 生成緊聲音，等一兩秒… " : "") +
      "聽唔到的話，檢查電腦或手機有冇靜音。"
  );
}

// ===== 第一次用：歡迎＋教學 =====
const W_STEPS = 4;
let installPrompt = null; // Android Chrome 的「安裝 app」事件

function showWelcome() {
  $("welcome").hidden = false;
  document.querySelector("header").hidden = true;
  document.querySelector("main").hidden = true;
  $("w-key").value = settings.apiKey;
  $("w-key-next").disabled = !settings.apiKey;
  goStep(0);
}

function closeWelcome() {
  settings = { ...settings, onboarded: true };
  store.saveSettings(settings);
  $("welcome").hidden = true;
  document.querySelector("header").hidden = false;
  document.querySelector("main").hidden = false;
  showTab("practice");
  window.scrollTo(0, 0);
}

function goStep(n) {
  document.querySelectorAll(".wstep").forEach((s, i) => (s.hidden = i !== n));
  $("w-dots").innerHTML = Array.from({ length: W_STEPS }, (_, i) => `<span class="${i === n ? "on" : ""}"></span>`).join("");
  if (n === 3) renderInstallTips();
  window.scrollTo(0, 0);
}

async function welcomeCheckKey() {
  const key = $("w-key").value.trim();
  const out = $("w-key-result");
  if (!key) return (out.innerHTML = "❌ 請先貼上 key");
  if (!key.startsWith("gsk_")) return (out.innerHTML = "❌ 條 key 應該係 <code>gsk_</code> 開頭，再複製一次？");
  out.innerHTML = "⏳ 檢查緊…";
  const btn = $("w-key-check");
  btn.disabled = true;
  try {
    await ai.chat({ ...settings, apiKey: key }, [{ role: "user", content: "Reply with exactly: OK" }], {
      maxTokens: 5,
      temperature: 0,
    });
    settings = { ...settings, apiKey: key };
    store.saveSettings(settings);
    out.innerHTML = "✅ 成功！條 key 已經儲存，撳「下一步」。";
    $("w-key-next").disabled = false;
  } catch (e) {
    const msg = String(e?.message).startsWith("401")
      ? "條 key 唔啱。返 Groq 網站再撳 Copy 複製一次，或者開一條新嘅？"
      : friendlyError(e);
    out.innerHTML = `❌ ${esc(msg)}`;
  } finally {
    btn.disabled = false;
  }
}

function welcomeMic() {
  recordAndTranscribe($("w-mic"), "🎤 再試一次", (text) => {
    $("w-mic-result").innerHTML = text
      ? `✅ 咪用得！Buddy 聽到：「${esc(text)}」`
      : "⚠️ 錄到音但聽唔到內容，講大聲啲再試？";
  });
}

function renderInstallTips() {
  const ua = navigator.userAgent;
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  let html;
  if (standalone) {
    html = "<p>✅ 你已經喺主畫面打開緊，唔使再加。</p>";
  } else if (/iPhone|iPad|iPod/.test(ua)) {
    html = `<p><b>iPhone／iPad（Safari）</b></p><ol>
      <li>撳畫面底部（或頂部）嘅<b>分享掣</b> <span class="hint">（一個正方形加向上箭咀 ⬆️）</span></li>
      <li>碌落去，撳 <b>「加入主畫面」</b></li>
      <li>撳右上角 <b>「加入」</b></li></ol>`;
  } else if (/Android/.test(ua)) {
    html = `<p><b>Android（Chrome）</b></p><ol>
      <li>撳右上角 <b>⋮</b></li>
      <li>撳 <b>「加到主畫面」</b>或者<b>「安裝應用程式」</b></li>
      <li>撳 <b>「新增」／「安裝」</b></li></ol>`;
  } else {
    html = `<p><b>電腦</b>：Edge／Chrome 網址列右邊如果有 <b>安裝</b> 圖示，撳佢就可以裝做 app。<br>
      <span class="hint">主要係用手機練，記得喺手機都開一次呢個網址。</span></p>`;
  }
  if (installPrompt && !standalone) {
    html += `<button type="button" id="w-install-btn" class="btn primary">📲 一撳安裝</button>`;
  }
  $("w-install").innerHTML = html;
  $("w-install-btn")?.addEventListener("click", async () => {
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => {});
    installPrompt = null;
    renderInstallTips();
  });
}

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e;
});

// 原本的模型唔用得、自動換咗另一個：記低，下次直接用
ai.setModelFallbackHandler((model) => {
  settings = { ...settings, model };
  store.saveSettings(settings);
  $("model").value = model;
  toast(`原本嘅模型用唔到，已自動轉用 ${model}`);
});

// ===== 啟動 =====
document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
$("start-btn").addEventListener("click", startSession);
// 再傾一次：返去揀話題
$("again-btn").addEventListener("click", () => {
  showView("home");
  window.scrollTo(0, 0);
});
$("suggest-btn").addEventListener("click", suggestTopics);
$("custom-topic").addEventListener("input", renderChips);
$("mic-btn").addEventListener("click", toggleMic);
$("text-form").addEventListener("submit", sendText);
$("end-btn").addEventListener("click", finish);
$("gap-btn").addEventListener("click", toggleGapBox);
$("gap-form").addEventListener("submit", saveGap);
$("review-say").addEventListener("click", reviewSay);
$("review-show").addEventListener("click", () => reviewItems && revealAnswer());
$("review-next").addEventListener("click", reviewNext);
// 跟讀示範再慢少少
$("play-btn").addEventListener("click", () =>
  phrases.length && ai.speak(phrases[pidx].en, { ...settings, rate: settings.rate * 0.9 }, onSpeakError)
);
$("shadow-btn").addEventListener("click", toggleShadow);
$("next-btn").addEventListener("click", () => {
  if (!phrases.length) return;
  pidx = (pidx + 1) % phrases.length;
  renderPhrase();
});
$("profile-save").addEventListener("click", saveProfile);
$("export-btn").addEventListener("click", exportData);
$("import-file").addEventListener("change", importData);
$("settings-save").addEventListener("click", saveSettings);
$("tts-engine").addEventListener("change", showEngineOptions);
// 設定一改就自動儲存，唔使記得撳「儲存設定」
$("tab-settings").addEventListener("change", (e) => {
  if (e.target.id === "import-file") return;
  settings = formSettings();
  store.saveSettings(settings);
});
$("rate").addEventListener("input", (e) => ($("rate-val").textContent = e.target.value));
$("voice-test").addEventListener("click", () => {
  ai.unlockSpeech();
  ai.speak("Hi! I'm Buddy. Nice to meet you!", formSettings());
});
$("test-key").addEventListener("click", testKey);
$("test-mic").addEventListener("click", testMic);
$("test-voice").addEventListener("click", testVoice);
if (window.speechSynthesis) speechSynthesis.addEventListener("voiceschanged", fillVoices);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  renderDash();
  if (!reviewItems) initReview(); // 過咗夜再開 app，會出現新一日嘅熱身
});
setInterval(renderTimer, 15000);

document.querySelectorAll("[data-wgo]").forEach((b) => b.addEventListener("click", () => goStep(Number(b.dataset.wgo))));
$("w-key-check").addEventListener("click", welcomeCheckKey);
$("w-mic").addEventListener("click", welcomeMic);
$("w-done").addEventListener("click", closeWelcome);
$("replay-welcome").addEventListener("click", showWelcome);

store.requestPersist();
renderDash();
renderChips();
initReview();
// 第一次用（未有 key 又未睇過教學）就出歡迎頁；舊用家已經有 key，唔會見到
if (!settings.apiKey && !settings.onboarded) {
  showWelcome();
} else if (!settings.apiKey) {
  showTab("settings");
  toast("請先輸入 Groq API key");
}
