// 跟讀練習：比較目標句子同語音辨識結果，標示可能讀得唔清楚的字。

const words = (text) => String(text).toLowerCase().match(/[a-z0-9']+/g) || [];

// 回傳 { score: 準確度 %, html: 標示後的句子, missed: 讀漏／讀錯的字 }
export function compareWords(target, said) {
  const t = words(target);
  const s = words(said);
  if (!t.length) return { score: 0, html: "", missed: [] };

  // 最長公共子序列（LCS），搵出讀啱咗的字
  const dp = Array.from({ length: t.length + 1 }, () => new Array(s.length + 1).fill(0));
  for (let i = t.length - 1; i >= 0; i--) {
    for (let j = s.length - 1; j >= 0; j--) {
      dp[i][j] = t[i] === s[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const matched = new Set();
  let i = 0;
  let j = 0;
  while (i < t.length && j < s.length) {
    if (t[i] === s[j]) {
      matched.add(i);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }

  // words() 只保留 [a-z0-9']，所以可以安全放入 HTML
  const html = t.map((w, k) => (matched.has(k) ? w : `<mark>${w}</mark>`)).join(" ");
  return {
    score: Math.round((100 * matched.size) / t.length),
    html,
    missed: t.filter((_, k) => !matched.has(k)),
  };
}
