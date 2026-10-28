// 睇圖認字：Gemini（建議，中文手寫認得最好）或者 Groq，由瀏覽器直接呼叫。

import { DEFAULT_GEMINI_MODEL, DEFAULT_GROQ_MODEL } from "./store.js";

const GEMINI = "https://generativelanguage.googleapis.com/v1beta";
const GROQ = "https://api.groq.com/openai/v1";
export const GROQ_MAX_IMAGES = 5; // Groq 每次最多 5 張圖

// 模型唔用得、自動換咗另一個時通知 app
let onModelFallback = () => {};
export function setModelFallbackHandler(fn) {
  onModelFallback = fn;
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

const splitDataUrl = (url) => {
  const [, mime, data] = url.match(/^data:(.+?);base64,(.*)$/);
  return { mime, data };
};

// parts：[{ text }｜{ image: dataURL }]，按次序組成一條訊息
// ===== Gemini =====
async function geminiRequest(key, model, parts) {
  const body = {
    contents: [
      {
        role: "user",
        parts: parts.map((p) =>
          p.image
            ? { inline_data: { mime_type: splitDataUrl(p.image).mime, data: splitDataUrl(p.image).data } }
            : { text: p.text }
        ),
      },
    ],
    generationConfig: { temperature: 0 },
  };
  return fetch(`${GEMINI}/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// 搵一個用得、識睇圖嘅 Flash 模型（最新版本優先）
async function findGeminiModel(key) {
  const res = await fetch(`${GEMINI}/models?pageSize=200`, { headers: { "x-goog-api-key": key } });
  const names = ((await check(res)).models || [])
    .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
    .map((m) => m.name.replace(/^models\//, ""))
    .filter((n) => /flash/i.test(n) && !/image|tts|audio|live|embed|thinking/i.test(n));
  // 排序：非 lite → latest 別名 → 正式版 → 版本號大嘅
  const version = (n) => (/latest/.test(n) ? 99 : parseFloat(n.match(/(\d+(\.\d+)?)/)?.[1] || "0"));
  const flag = (re) => (n) => (re.test(n) ? 1 : 0);
  const lite = flag(/lite/);
  const preview = flag(/preview|exp/);
  names.sort((a, b) => lite(a) - lite(b) || preview(a) - preview(b) || version(b) - version(a));
  return names[0] || null;
}

async function geminiRecognize(settings, parts) {
  let model = settings.geminiModel || DEFAULT_GEMINI_MODEL;
  let res = await geminiRequest(settings.geminiKey, model, parts);
  if (res.status === 404 || res.status === 403) {
    const fallback = await findGeminiModel(settings.geminiKey).catch(() => null);
    if (fallback && fallback !== model) {
      model = fallback;
      onModelFallback("geminiModel", model);
      res = await geminiRequest(settings.geminiKey, model, parts);
    }
  }
  const data = await check(res);
  const cand = data.candidates?.[0];
  if (!cand?.content) throw new Error(`AI 冇回應（${cand?.finishReason || data.promptFeedback?.blockReason || "不明原因"}）`);
  return cand.content.parts
    .filter((p) => !p.thought)
    .map((p) => p.text || "")
    .join("");
}

// ===== Groq =====
async function groqRequest(key, model, parts) {
  const content = parts.map((p) =>
    p.image ? { type: "image_url", image_url: { url: p.image } } : { type: "text", text: p.text }
  );
  return fetch(`${GROQ}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "user", content }], temperature: 0, max_tokens: 4096 }),
  });
}

async function findGroqModel(key) {
  const res = await fetch(`${GROQ}/models`, { headers: { Authorization: `Bearer ${key}` } });
  const ids = ((await check(res)).data || []).filter((m) => m.active !== false).map((m) => m.id);
  return ids.find((id) => /scout|maverick|vision|-vl|vl-/i.test(id)) || null;
}

async function groqRecognize(settings, parts) {
  let model = settings.groqModel || DEFAULT_GROQ_MODEL;
  let res = await groqRequest(settings.groqKey, model, parts);
  if (res.status === 404 || res.status === 403) {
    const fallback = await findGroqModel(settings.groqKey).catch(() => null);
    if (!fallback) throw new Error("Groq 而家冇你用得嘅睇圖模型，請喺「設定」改用 Gemini");
    if (fallback !== model) {
      model = fallback;
      onModelFallback("groqModel", model);
      res = await groqRequest(settings.groqKey, model, parts);
    }
  }
  const data = await check(res);
  return data.choices?.[0]?.message?.content || "";
}

export async function ask(settings, parts) {
  const text = settings.provider === "groq" ? await groqRecognize(settings, parts) : await geminiRecognize(settings, parts);
  // 剷走推理標記同包住成段嘅 ``` 符號
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/^\s*```[a-z]*\n?|\n?```\s*$/g, "")
    .trim();
}
