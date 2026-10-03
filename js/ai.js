// AI 服務：對話同語音辨識用 Groq（瀏覽器直接呼叫），朗讀用瀏覽器內置語音。

const BASE = "https://api.groq.com/openai/v1";
// Groq 免費（Developer）方案用得的對話模型，越前越優先；Llama 已改為企業版專用
const PREFERRED_MODELS = ["openai/gpt-oss-120b", "openai/gpt-oss-20b"];
export const DEFAULT_MODEL = PREFERRED_MODELS[0];
const ASR_MODEL = "whisper-large-v3-turbo";

// 模型唔用得、自動換咗另一個時通知 app（用嚟儲存設定同提示使用者）
export let onModelFallback = () => {};
export function setModelFallbackHandler(fn) {
  onModelFallback = fn;
}

// 用 /models 搵一個呢條 key 用得的對話模型
async function findAvailableModel(apiKey) {
  const res = await fetch(`${BASE}/models`, { headers: { Authorization: `Bearer ${apiKey}` } });
  const ids = ((await check(res)).data || []).filter((m) => m.active !== false).map((m) => m.id);
  return (
    PREFERRED_MODELS.find((id) => ids.includes(id)) ||
    ids.find((id) => !/whisper|guard|tts|orpheus|playai|compound|distil/i.test(id)) ||
    null
  );
}

async function check(res) {
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.json()).error?.message || "";
    } catch {}
    throw new Error(`${res.status} ${detail}`.trim());
  }
  return res.json();
}

async function requestChat(apiKey, model, messages, maxTokens, temperature) {
  const body = { model, messages, max_tokens: maxTokens, temperature };
  if (/gpt-oss/i.test(model)) {
    // 推理模型：少諗啲、快啲；推理過程唔使返嚟；推理會食 token，所以預多啲
    Object.assign(body, { reasoning_effort: "low", include_reasoning: false, max_tokens: maxTokens + 512 });
  }
  return fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function chat(settings, messages, { maxTokens = 300, temperature = 0.7 } = {}) {
  let model = settings.model || DEFAULT_MODEL;
  let res = await requestChat(settings.apiKey, model, messages, maxTokens, temperature);

  // 模型停用或者冇權限（404／403）：自動換一個用得的模型再試
  if (res.status === 404 || res.status === 403) {
    const fallback = await findAvailableModel(settings.apiKey).catch(() => null);
    if (fallback && fallback !== model) {
      model = fallback;
      onModelFallback(model);
      res = await requestChat(settings.apiKey, model, messages, maxTokens, temperature);
    }
  }

  const data = await check(res);
  const text = data.choices?.[0]?.message?.content || "";
  // 部分推理模型會輸出 <think>…</think>，要剷走
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

export async function transcribe(apiKey, blob) {
  const ext = blob.type.includes("mp4") ? "mp4" : blob.type.includes("ogg") ? "ogg" : "webm";
  const form = new FormData();
  form.append("file", blob, `speech.${ext}`);
  form.append("model", ASR_MODEL);
  form.append("language", "en");
  form.append("response_format", "json");
  const res = await fetch(`${BASE}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  return ((await check(res)).text || "").trim();
}

// ===== 錄音 =====
export async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
  });
  const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((t) =>
    window.MediaRecorder?.isTypeSupported?.(t)
  );
  const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  const chunks = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.start();
  return {
    stop: () =>
      new Promise((resolve) => {
        recorder.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          resolve(new Blob(chunks, { type: recorder.mimeType || type || "audio/webm" }));
        };
        recorder.stop();
      }),
  };
}

// ===== 朗讀 =====
const synth = window.speechSynthesis;

// 溫柔、自然的女聲優先（Edge／Windows 的 Natural 聲線、iPhone 的 Ava／Samantha、Android 的 Google 聲線）
const PREFERRED = [
  /ava.*(natural|premium|enhanced)/i,
  /jenny.*natural/i,
  /emma.*natural/i,
  /aria.*natural/i,
  /ava/i,
  /samantha/i,
  /google us english/i,
  /natural/i,
  /female/i,
];
const rank = (v) => {
  const i = PREFERRED.findIndex((p) => p.test(v.name));
  return i === -1 ? PREFERRED.length : i;
};

// 英文聲線，越推薦越前
export function englishVoices() {
  if (!synth) return [];
  return synth
    .getVoices()
    .filter((v) => v.lang.toLowerCase().startsWith("en"))
    .sort((a, b) => rank(a) - rank(b));
}

function pickVoice(uri) {
  const voices = englishVoices();
  return (uri && voices.find((v) => v.voiceURI === uri)) || voices[0] || null;
}

// ===== Groq Orpheus（更有感情的 AI 聲線） =====
const TTS_MODEL = "canopylabs/orpheus-v1-english";
const TTS_MAX_CHARS = 200; // Orpheus 每次最多 200 字元
export const ORPHEUS_VOICES = [
  ["hannah", "Hannah（女）"],
  ["diana", "Diana（女）"],
  ["autumn", "Autumn（女）"],
  ["daniel", "Daniel（男）"],
  ["austin", "Austin（男）"],
  ["troy", "Troy（男）"],
];
const player = new Audio();
const ttsCache = new Map(); // 讀過的句子留低，重播唔使再用額度
const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";
let generation = 0; // 每次新朗讀 +1，用嚟停止舊的

// 按句子拆段，每段唔超過 maxLen 字元
function splitForTts(text, maxLen) {
  const pieces = text.match(/[^.!?]+[.!?]*\s*/g) || [text];
  const chunks = [];
  let current = "";
  for (let piece of pieces) {
    while (piece.length > maxLen) {
      // 單一句太長：喺 maxLen 之前最後一個空格切開
      const cut = piece.lastIndexOf(" ", maxLen) > 0 ? piece.lastIndexOf(" ", maxLen) : maxLen;
      if (current) chunks.push(current.trim()), (current = "");
      chunks.push(piece.slice(0, cut).trim());
      piece = piece.slice(cut);
    }
    if ((current + piece).length > maxLen) chunks.push(current.trim()), (current = "");
    current += piece;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter(Boolean);
}

async function orpheusAudio(apiKey, voice, input) {
  const key = `${voice}|${input}`;
  if (ttsCache.has(key)) return ttsCache.get(key);
  const res = await fetch(`${BASE}/audio/speech`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: TTS_MODEL, input, voice, response_format: "wav" }),
  });
  if (!res.ok) await check(res); // 會拋出錯誤
  const url = URL.createObjectURL(await res.blob());
  ttsCache.set(key, url);
  if (ttsCache.size > 40) {
    const [oldKey, oldUrl] = ttsCache.entries().next().value;
    URL.revokeObjectURL(oldUrl);
    ttsCache.delete(oldKey);
  }
  return url;
}

function playUrl(url, rate, gen) {
  return new Promise((resolve, reject) => {
    if (gen !== generation) return resolve();
    player.src = url;
    player.preservesPitch = true;
    player.playbackRate = rate;
    player.onended = resolve;
    player.onerror = () => reject(new Error("播放失敗"));
    player.play().catch(reject);
  });
}

async function speakOrpheus(text, settings, gen) {
  const tag = settings.ttsStyle ? `[${settings.ttsStyle}] ` : "";
  const chunks = splitForTts(text, TTS_MAX_CHARS - tag.length);
  // 所有段落同時開始生成，逐段播放
  const urls = chunks.map((c) => orpheusAudio(settings.apiKey, settings.orpheusVoice || "hannah", tag + c));
  urls.forEach((p) => p.catch(() => {}));
  // Orpheus 冇速度參數，用播放速度代替；語速 0.85（預設）＝原速
  const rate = Math.min(1.3, Math.max(0.7, (Number(settings.rate) || 0.85) / 0.85));
  for (const p of urls) {
    const url = await p;
    if (gen !== generation) return;
    await playUrl(url, rate, gen);
  }
}

// ===== 朗讀（統一入口） =====

// iOS 要喺使用者撳掣時先播一次，之後先可以自動朗讀（用無聲的空格，Chrome 遇到空字串會卡住）
export function unlockSpeech() {
  player.src = SILENT_WAV;
  player.play().catch(() => {});
  if (!synth) return;
  const u = new SpeechSynthesisUtterance(" ");
  u.volume = 0;
  synth.speak(u);
}

let speakTimer;

export function stopSpeaking() {
  generation++;
  clearTimeout(speakTimer);
  player.pause();
  synth?.cancel();
}

function speakBrowser(text, settings, onError) {
  if (!synth) return onError?.("呢個瀏覽器唔支援朗讀");
  synth.resume(); // Chrome 有時會卡喺暫停狀態
  const utterance = new SpeechSynthesisUtterance(text);
  const voice = pickVoice(settings.voiceURI);
  if (voice) utterance.voice = voice;
  utterance.lang = voice?.lang || "en-US";
  utterance.rate = Number(settings.rate) || 0.85;
  utterance.onerror = (e) => {
    if (e.error !== "interrupted" && e.error !== "canceled") onError?.(`朗讀失敗（${e.error}），撳 🔊 重播`);
  };
  // Chrome：cancel 之後即刻 speak 有時會冇聲，稍等一下先播
  speakTimer = setTimeout(() => synth.speak(utterance), 120);
}

// 顯示用：而家實際會用邊把聲
export function describeVoice(settings) {
  if (settings.ttsEngine === "orpheus") {
    const name = ORPHEUS_VOICES.find(([id]) => id === settings.orpheusVoice)?.[1] || settings.orpheusVoice;
    return `Orpheus ${name}${settings.ttsStyle ? `，語氣 ${settings.ttsStyle}` : ""}`;
  }
  const v = pickVoice(settings.voiceURI);
  return v ? `瀏覽器 ${v.name}（${v.lang}）` : "瀏覽器預設聲線";
}

const ORPHEUS_TERMS_URL = "https://console.groq.com/playground?model=canopylabs/orpheus-v1-english";
let orpheusBlocked = false; // 未同意條款等永久錯誤：今次開 app 期間唔再試，直接用瀏覽器聲音

// onError(訊息)：朗讀失敗或者轉咗用後備聲音時通知
export function speak(text, settings, onError, { retryOrpheus = false } = {}) {
  if (!text) return;
  stopSpeaking();
  const gen = generation;
  if (retryOrpheus) orpheusBlocked = false;
  if (settings.ttsEngine === "orpheus" && settings.apiKey && !orpheusBlocked) {
    speakOrpheus(text, settings, gen).catch((e) => {
      if (gen !== generation) return;
      const msg = e.message;
      if (/terms/i.test(msg)) {
        orpheusBlocked = true;
        onError?.(`Orpheus 要先同意條款先用得：去 ${ORPHEUS_TERMS_URL} 撳同意。今次改用瀏覽器聲音。`);
      } else {
        if (/^(401|403|404)/.test(msg)) orpheusBlocked = true;
        onError?.(`Orpheus 用唔到（${msg.slice(0, 200)}），今次改用瀏覽器聲音`);
      }
      speakBrowser(text, settings, onError);
    });
    return;
  }
  speakBrowser(text, settings, onError);
}
