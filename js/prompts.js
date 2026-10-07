// 所有俾 LLM 的提示詞，集中喺度方便之後調整。

const facts = (profile) => profile.slice(-30).map((f) => `- ${f}`).join("\n") || "- (nothing yet)";

export function chatSystemPrompt(profile, topic, wrapUp) {
  let prompt = `You are "Buddy", a warm, encouraging English-speaking friend chatting with a Cantonese speaker from Hong Kong who is practising spoken English on their phone.

Today's topic: ${topic}

What you remember about them:
${facts(profile)}

Rules:
- Talk like a friendly native-speaker friend: casual and relaxed, not like a teacher.
- Keep each reply short: 1-3 sentences, then ask ONE open question to keep them talking.
- Use clear, everyday English (around CEFR B1); avoid rare idioms.
- Never point out mistakes or explain grammar during the chat. Instead, when they make a mistake, naturally echo the correct version inside your reply, the way a friendly native speaker would (a "recast"). Example:
  Learner: "Yesterday I go to Mong Kok and buy many thing."
  You: "Oh, you went to Mong Kok yesterday? What did you buy?"
  Recast at most one thing per reply, only when it fits naturally, and never say "you should say" or "correct".
- NEVER copy the learner's mistakes. Whenever you reuse their words, always use the correct, natural form
  (e.g. if they say "fish boiled noodles", you say "boiled fish noodles"; if they say "I very like", you say "you really like").
- If you can't understand, gently ask them to say it another way.
- Be encouraging. Now and then share a short, relatable comment or tiny story of your own.
- Naturally bring up what you remember about them when relevant.
- Their messages come from speech recognition, so ignore small transcription glitches.
- Plain text only: no emojis, no markdown, no lists (your reply is read aloud).`;
  if (wrapUp) {
    prompt +=
      "\n- Time is nearly up: start wrapping up warmly in this reply or the next " +
      "(e.g. say it was great chatting and you look forward to tomorrow).";
  }
  return prompt;
}

// requested：使用者揀咗或者自己打的話題（可能係中文）；冇就由 AI 揀
export function topicPrompt(profile, recentTopics, requested) {
  const recent = recentTopics.map((t) => `- ${t}`).join("\n") || "- (none)";
  const instruction = requested
    ? `The learner chose today's topic themselves (it may be written in Chinese): "${requested}"
Build today's chat around exactly this topic, made specific and fun. If it is a role-play (e.g. airport, hotel, interview), set the scene in the opener and play the other person.`
    : `Recent topics (do not repeat):
${recent}

Mix everyday life and travel themes. If there are facts, about half the time build the topic around their own life (work, hobbies, upcoming trips, family).`;
  return `Pick today's topic for a 10-minute casual English chat with a learner from Hong Kong.

Facts about the learner:
${facts(profile)}

${instruction}

Return ONLY JSON:
{"topic": "<short English topic>", "topic_zh": "<the topic in Traditional Chinese (Hong Kong)>", "opener": "<friendly greeting plus one open question, max 2 sentences, plain text, no emojis>"}`;
}

// ✨ 建議話題：按使用者興趣，避開最近傾過的
export function suggestPrompt(profile, recentTopics) {
  const recent = recentTopics.map((t) => `- ${t}`).join("\n") || "- (none)";
  return `Suggest 3 different, specific and fun topics for a 10-minute casual English chat with a learner from Hong Kong.

Facts about the learner:
${facts(profile)}

Recent topics (avoid these):
${recent}

Mix: one about their own life (if facts exist), one everyday-life topic, one travel or role-play situation.

Return ONLY JSON:
{"topics": [{"topic": "<short English topic>", "topic_zh": "<short Traditional Chinese (Hong Kong) label, max 10 characters>"}]}`;
}

// 每句 💡 提示：只檢查使用者最新一句，回應要短，慳用量。
export function tipPrompt(previousAi, userText) {
  return `Check one spoken English sentence from a Hong Kong learner (captured by speech recognition).

Context (what their friend just said): ${previousAi}
Learner said: ${userText}

Flag it only if there is a real grammar error, wrong word, or clearly unnatural phrasing.
Ignore punctuation, capitalisation, filler words, and likely speech-recognition glitches.

Return ONLY JSON, one of:
{"ok": true}
{"ok": false, "better": "<the learner's sentence, minimally corrected to sound natural>", "note": "<max 15 Chinese characters in Traditional Chinese (Hong Kong) explaining the key fix>"}`;
}

// gaps：傾偈時撳「🆘 講唔出」記低嘅 { zh: 想講嘅嘢（多數係中文）, context: Buddy 上一句 }
export function summaryPrompt(transcript, gaps = []) {
  const stuck = gaps.length
    ? gaps.map((g, i) => `${i + 1}. Buddy had just said: "${g.context}" / Learner wanted to say: "${g.zh}"`).join("\n")
    : "(none)";
  return `You are a kind English coach. Review this spoken English practice. Lines from "Learner" were captured by speech recognition.

Transcript:
${transcript}

Moments the learner got stuck and noted what they wanted to say (often in Chinese):
${stuck}

Return ONLY JSON:
{
 "praise": "1-2 sentences in Traditional Chinese (Hong Kong) praising something specific they did well",
 "gaps": [{"zh": "what they wanted to say, copied as given", "en": "a natural spoken English way to say it that fits the chat", "simple": "an easier way using only basic words"}],
 "corrections": [{"original": "learner's sentence", "better": "more natural version", "explain": "short reason in Traditional Chinese"}],
 "pronunciation": [{"word": "English word", "tip": "short tip in Traditional Chinese"}],
 "phrases": [{"en": "useful natural phrase for today's topic", "zh": "meaning in Traditional Chinese"}],
 "new_facts": ["short English fact the learner revealed about themselves"]
}

Rules:
- gaps: one item for each stuck moment above, in the same order. Keep "en" short and spoken (max 15 words). [] if none.
- corrections: max 3, the most useful ones only; skip trivial ones. [] if none.
- pronunciation: max 3. Include a word only if the transcript suggests a likely mispronunciation (an odd, out-of-context word that sounds like what they probably meant), or it is a word they used with a common pitfall for Cantonese speakers (th, final consonants, v/w, l/n, r/l). [] if nothing.
- phrases: exactly 3, short and practical, at the learner's level.
- new_facts: personal info such as job, hobbies, plans, family, likes. [] if none.`;
}

// 由 LLM 回應中抽出第一個 JSON 物件；失敗回傳 null。
export function parseJson(text) {
  const match = String(text).match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const data = JSON.parse(match[0]);
    return data && typeof data === "object" && !Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}
