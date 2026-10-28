// 所有提示詞。認字嘅指示用英文寫（模型跟得最準），輸出係手寫原文。

export const UNSURE_OPEN = "⟦";
export const UNSURE_CLOSE = "⟧";

const BASE_RULES = `You are reading a photo of handwriting written by ONE specific person. It may be Traditional Chinese, English, or a mix of both.
Rules:
- Transcribe exactly what is written. Keep the original line breaks, punctuation and spelling, including mistakes. Do not correct, translate or explain.
- Chinese: use the Traditional Chinese characters as written (do not convert to Simplified).
- Skip text that has been crossed out.
- If a character or word is unclear, write your best guess and wrap it in ${UNSURE_OPEN} ${UNSURE_CLOSE}, e.g. ${UNSURE_OPEN}末${UNSURE_CLOSE}.
- Output only the transcription, nothing else.`;

// confusions：[{ written, misread, count }]
export function habitsText(confusions) {
  if (!confusions.length) return "";
  const lines = confusions.map(
    (c) => `- What this person writes as "${c.written}" has been misread as "${c.misread}" (${c.count}×).`
  );
  return `\nKnown habits of this writer, learned from past corrections:\n${lines.join("\n")}`;
}

export const recognizeIntro = (confusions) => BASE_RULES + habitsText(confusions);

export const exampleIntro =
  "Below are earlier samples of this same person's handwriting, each followed by its correct transcription. Use them to learn how they form letters and characters.";

export const exampleCaption = (text) => `Correct transcription of the sample above:\n${text}`;

export const sheetIntro =
  "Reference sheet: each box shows how this person handwrites one character, letter or word. The blue printed label under each box is the correct reading.";

export const targetIntro = "Now transcribe this photo:";

export const reviewText = (draft) =>
  `A first reading of the photo was:\n"""\n${draft}\n"""\nCompare the photo carefully with the reference sheet, especially the parts marked ${UNSURE_OPEN} ${UNSURE_CLOSE}, and output the corrected full transcription following the same rules.`;
