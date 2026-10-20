// 所有俾 LLM 的提示詞，集中喺度方便之後調整。

// 每個 CEFR 程度講嘢應該點：用嚟控制 Buddy 嘅用字同句式
const LEVEL_GUIDE = {
  A1: "very short, very simple sentences; only the most common everyday words; present tense mostly",
  A2: "short simple sentences; common everyday words; simple past and future; no idioms",
  "A2+": "simple sentences with some linking words (because, so, but); everyday vocabulary; a few very common phrasal verbs",
  B1: "clear everyday English; common phrasal verbs; simple opinions and reasons; avoid rare idioms",
  "B1+": "natural everyday English with a wider vocabulary; some conditionals; occasionally a common idiom",
  B2: "natural conversational pace; varied sentence structures; common idioms and phrasal verbs; can discuss abstract ideas",
  "B2+": "fluent, natural English with some less common vocabulary and idioms; nuanced opinions",
  C1: "fluent, idiomatic, nuanced English as between native speakers, but still clear",
  C2: "fully natural native-speaker English, including idioms and subtle humour",
};
const guide = (band) => LEVEL_GUIDE[band] || LEVEL_GUIDE.B1;
const BAND_LIST = Object.keys(LEVEL_GUIDE).join(", ");

const facts = (profile) => profile.slice(-30).map((f) => `- ${f}`).join("\n") || "- (nothing yet)";

// 冇路線時（出題失敗）用的通用角度
export const DEFAULT_ANGLES = [
  "Get them to describe it in concrete detail (who, where, what it looks or feels like)",
  "Ask for a specific story: a time something memorable, funny or annoying happened",
  "Ask their opinion and the reason behind it; share a mildly different view of your own",
  "Ask a hypothetical: what would they do or change if they could",
];

// plan：{ angles: [傾偈路線], step: 而家行到第幾步 }
// band：Buddy 講嘢用嘅 CEFR 程度（比使用者高少少）
export function chatSystemPrompt(profile, topic, wrapUp, plan, band = "B1") {
  const angles = plan?.angles?.length ? plan.angles : DEFAULT_ANGLES;
  const step = Math.min(plan?.step || 0, angles.length - 1);
  let prompt = `You are "Buddy", a warm, encouraging English-speaking friend chatting with a Cantonese speaker from Hong Kong who is practising spoken English on their phone.

Today's topic: ${topic}

Today's conversation plan (each step digs deeper into the SAME topic):
${angles.map((a, i) => `${i + 1}. ${a}`).join("\n")}
You are now on step ${step + 1}. Stay on it while the learner still has things to say; when the thread runs dry, move naturally to the next step. Do not jump ahead to the end.

Background facts you remember about them (use one ONLY if it connects directly to today's topic):
${facts(profile)}

Rules:
- Talk like a friendly native-speaker friend: casual and relaxed, not like a teacher.
- Keep each reply short: 1-3 sentences, then ask ONE open question to keep them talking.
- Speak at CEFR ${band} level: ${guide(band)}. This is one step above the learner's current level on purpose, to stretch them a little. If they seem lost, rephrase more simply.
- Never point out mistakes or explain grammar during the chat. Instead, when they make a mistake, naturally echo the correct version inside your reply, the way a friendly native speaker would (a "recast"). Example:
  Learner: "Yesterday I go to Mong Kok and buy many thing."
  You: "Oh, you went to Mong Kok yesterday? What did you buy?"
  Recast at most one thing per reply, only when it fits naturally, and never say "you should say" or "correct".
- NEVER copy the learner's mistakes. Whenever you reuse their words, always use the correct, natural form
  (e.g. if they say "fish boiled noodles", you say "boiled fish noodles"; if they say "I very like", you say "you really like").
- If you can't understand, gently ask them to say it another way.
- Be encouraging. Now and then share a short, relatable comment or tiny story of your own.
- Stay on today's topic. Never steer the chat back to subjects from past chats or from the background facts (for example food, unless today's topic is food). If the learner drifts, follow for one reply, then bridge back to the plan.
- Vary your question types and avoid asking the same kind twice in a row: a specific story, an opinion with a reason, a comparison (Hong Kong vs elsewhere, past vs now), a hypothetical, or a reaction to your own mildly different view. Avoid generic questions like "What do you like about it?".
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
    : `Recent topics (do not repeat them, or their general theme; e.g. if several were about food, pick something unrelated to food):
${recent}

Mix everyday life and travel themes. If there are facts, about a third of the time build the topic around their own life (work, hobbies, upcoming trips, family), but not around a theme already in the recent topics.`;
  return `Pick today's topic for a 10-minute casual English chat with a learner from Hong Kong, and plan how the chat will go deeper.

Facts about the learner:
${facts(profile)}

${instruction}

Then write "angles": a 4-step plan that stays on this ONE topic and goes deeper each step. Each step is a different kind of conversation move, written as a short instruction to the chat partner with a concrete, specific question idea. Use a mix of: describe in detail, tell a specific story, give an opinion with reasons, compare (Hong Kong vs elsewhere, past vs now), a hypothetical or dilemma, react to a surprising fact or a mildly different opinion.
For a role-play, the 4 steps are the stages of the scene instead, including one small problem the learner must handle (e.g. the room is not ready, a dish is wrong).

Return ONLY JSON:
{"topic": "<short English topic>", "topic_zh": "<the topic in Traditional Chinese (Hong Kong)>", "opener": "<friendly greeting plus one open question for step 1, max 2 sentences, plain text, no emojis>", "angles": ["<step 1>", "<step 2>", "<step 3>", "<step 4>"]}`;
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
The 3 topics must have clearly different themes from each other and from the recent topics (e.g. at most one may involve food).

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
// band：教新句子用嘅程度（比使用者高少少）
export function summaryPrompt(transcript, gaps = [], band = "B1") {
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
 "pronunciation": [{"word": "English word", "tip": "short tip in Traditional Chinese", "example": "a short natural sentence using the word, ideally the one they said"}],
 "phrases": [{"en": "useful natural phrase for today's topic", "zh": "meaning in Traditional Chinese"}],
 "new_facts": ["short English fact the learner revealed about themselves"],
 "cefr": "<the learner's SPEAKING level shown in this chat, one of: ${BAND_LIST}>",
 "cefr_reason": "<max 40 characters in Traditional Chinese (Hong Kong): the main evidence for this level>",
 "next_step": "<max 40 characters in Traditional Chinese (Hong Kong): the one thing to work on to reach the next level>"
}

Rules:
- cefr: judge only the Learner's lines using the CEFR spoken interaction and production descriptors (range of vocabulary and grammar, accuracy, fluency, coherence, ability to explain and give reasons). Ignore obvious speech-recognition glitches. Be fair and realistic, not generous. A "+" means clearly above that level but not yet the next one.
- gaps: one item for each stuck moment above, in the same order. Keep "en" short and spoken (max 15 words). [] if none.
- corrections: max 3, the most useful ones only; skip trivial ones. [] if none.
- pronunciation: max 3. Include a word only if the transcript suggests a likely mispronunciation (an odd, out-of-context word that sounds like what they probably meant), or it is a word they used with a common pitfall for Cantonese speakers (th, final consonants, v/w, l/n, r/l). [] if nothing.
- phrases: exactly 3, short and practical, at CEFR ${band} (slightly above the learner's level, so they learn something new).
- new_facts: personal info such as job, hobbies, plans, family, likes. [] if none.`;
}

// 🎧 聽寫：出 5 句真人日常會講、又有聽力難點嘅句子
export function dictationPrompt(topic, band = "B1") {
  return `Write 5 sentences for an English listening dictation exercise for a Cantonese speaker from Hong Kong, at CEFR ${band} level (${guide(band)}).

Theme: ${topic || "mixed everyday situations (work, travel, shopping, plans, feelings, small talk)"}

Rules:
- Each is something people really say in casual conversation, 6-14 words, standard spelling (write "going to", not "gonna").
- Each sentence should contain at least one thing that is hard to catch by ear: linking between words ("pick it up"), weak forms (to, of, for, can, have), contractions (I'd, you'll, wouldn't), word endings (-ed, -s, -t), or a common phrasal verb.
- Write numbers in words. No names or rare words.
- Go from easier to harder.

Return ONLY JSON:
{"sentences": [{"en": "<sentence>", "zh": "<meaning in Traditional Chinese (Hong Kong)>"}]}`;
}

// 🎧 聽寫回饋：分析點解聽唔到
export function dictationFeedbackPrompt(target, typed) {
  return `A Hong Kong learner did an English listening dictation. Find what they failed to catch and explain why.

Sentence played: "${target}"
Learner typed: "${typed || "(nothing)"}"

Ignore capitalisation, punctuation and small spelling slips that show they clearly heard the word.

Return ONLY JSON:
{"items": [{"heard": "<what they typed for this part, '' if nothing>", "actual": "<the words actually said>", "reason": "<one of: linking, weak, contraction, ending, similar, unknown, fast>", "explain": "<max 30 characters in Traditional Chinese (Hong Kong): how it really sounds and why it is hard to catch>"}], "tip": "<one short practical listening tip in Traditional Chinese (Hong Kong)>"}

Rules: max 4 items, real misses only, in sentence order. reason meanings: linking = words run together, weak = unstressed small word, contraction = shortened form, ending = word ending not heard, similar = confused with a similar-sounding word, unknown = probably doesn't know the word, fast = missed a whole chunk.`;
}

// 📖 撳字查解釋：按句子語境解釋，連同片語同相關詞彙
export function wordPrompt(word, sentence) {
  return `A Cantonese speaker from Hong Kong learning English tapped a word they don't know in this sentence.

Sentence: "${sentence}"
Word tapped: "${word}"

Explain it as used in THIS sentence. If the word is part of a phrase, phrasal verb or idiom here (e.g. "pick up", "by the way", "end up"), explain the whole phrase.

Return ONLY JSON:
{"term": "<the word or whole phrase explained>", "ipa": "<IPA pronunciation of term>", "pos": "<part of speech in Traditional Chinese, e.g. 動詞、名詞、片語>", "meaning": "<meaning in this sentence, Traditional Chinese (Hong Kong), max 25 characters>", "example": "<a new, simple everyday example sentence using term>", "example_zh": "<its Traditional Chinese (Hong Kong) translation>", "related": [{"en": "<related word or phrase>", "zh": "<short Traditional Chinese meaning>"}]}

Rules: related = 3-4 items most useful in daily conversation: common collocations, the word family (e.g. decide / decision), or a simpler synonym.`;
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
