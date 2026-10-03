// 個人資料儲存：記憶、練習紀錄、打卡、徽章、設定。全部存喺瀏覽器 localStorage。

import { DEFAULT_MODEL } from "./ai.js";

const DATA_KEY = "english-buddy-data";
const SETTINGS_KEY = "english-buddy-settings";
const MAX_PROFILE = 60;
const MAX_PHRASES = 300;

export const BADGES = [
  [1, "🌱 第一步"],
  [3, "🔥 三日不斷"],
  [7, "⭐ 一星期"],
  [14, "🏅 兩星期"],
  [30, "🏆 一個月"],
  [100, "👑 一百日"],
];

// 香港冇夏令時間，固定 UTC+8
export const todayHK = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const empty = () => ({ profile: [], sessions: [], phrases: [] });

export function load() {
  try {
    return { ...empty(), ...JSON.parse(localStorage.getItem(DATA_KEY) || "{}") };
  } catch {
    return empty();
  }
}

export function save(data) {
  localStorage.setItem(DATA_KEY, JSON.stringify(data));
}

// 叫瀏覽器唔好自動清走資料（唔支援就算）
export function requestPersist() {
  navigator.storage?.persist?.().catch(() => {});
}

export function addSession(data, topic, minutes, turns, facts, phrases) {
  const date = todayHK();
  data.sessions.push({ date, topic, minutes: Math.round(minutes * 10) / 10, turns });

  // 新記憶：去重，保留最新的 MAX_PROFILE 項
  const known = new Set(data.profile.map((f) => f.toLowerCase()));
  for (const fact of facts) {
    const f = typeof fact === "string" ? fact.trim() : "";
    if (f && !known.has(f.toLowerCase())) {
      data.profile.push(f);
      known.add(f.toLowerCase());
    }
  }
  data.profile = data.profile.slice(-MAX_PROFILE);

  data.phrases.push(...phrases.map((p) => ({ en: p.en, zh: p.zh || "", date })));
  data.phrases = data.phrases.slice(-MAX_PHRASES);
}

const dates = (data) => new Set(data.sessions.map((s) => s.date));

export const doneToday = (data) => dates(data).has(todayHK());

// 連續練習日數；今日未練但琴日有練，連續紀錄仍然生效
export function currentStreak(data) {
  const ds = dates(data);
  let day = ds.has(todayHK()) ? todayHK() : addDays(todayHK(), -1);
  let n = 0;
  while (ds.has(day)) {
    n++;
    day = addDays(day, -1);
  }
  return n;
}

export function longestStreak(data) {
  let best = 0;
  let run = 0;
  let prev = null;
  for (const d of [...dates(data)].sort()) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}

export const earnedBadges = (data) => {
  const best = longestStreak(data);
  return BADGES.filter(([days]) => best >= days).map(([, name]) => name);
};

// ===== 設定 =====
const SETTINGS_VERSION = 3;
const DEFAULT_SETTINGS = {
  v: SETTINGS_VERSION,
  apiKey: "",
  model: DEFAULT_MODEL,
  ttsEngine: "browser", // browser＝瀏覽器內置；orpheus＝Groq Orpheus
  voiceURI: "", // 瀏覽器聲線
  orpheusVoice: "hannah",
  ttsStyle: "gentle", // Orpheus 語氣標記
  rate: 0.85,
  showTips: true,
};

export function loadSettings() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
  } catch {}
  // v2：預設語速改慢（0.95 → 0.85），聲線改為自動揀溫柔女聲
  if ((saved.v || 1) < 2) {
    delete saved.rate;
    delete saved.voiceURI;
  }
  // v3：Groq 將 Llama 改為企業版專用，舊預設模型改用新預設
  if ((saved.v || 1) < 3 && saved.model === "llama-3.3-70b-versatile") {
    delete saved.model;
  }
  return { ...DEFAULT_SETTINGS, ...saved, v: SETTINGS_VERSION };
}

export function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
