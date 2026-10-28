// 比較「AI 讀到嘅」同「你改好嘅」，搵出邊啲字讀錯咗（LCS 逐個字對齊）。

const chars = (s) => Array.from(s);
const isSpace = (s) => /^\s*$/.test(s);

// 回傳 [{ written: 你寫嘅, misread: AI 讀咗做 }]
export function findCorrections(aiText, fixedText) {
  const a = chars(aiText);
  const b = chars(fixedText);
  // 太長就唔做（LCS 要 a×b 記憶體）
  if (a.length * b.length > 4e6) return [];

  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);

  // 行一次，將連續唔對得上嘅片段收集起嚟
  const gaps = [];
  let gap = { a: "", b: "" };
  const flush = () => {
    if (gap.a || gap.b) gaps.push(gap);
    gap = { a: "", b: "" };
  };
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      flush();
      i++, j++;
    } else if (j < m && (i === n || dp[i][j + 1] >= dp[i + 1][j])) {
      gap.b += b[j++];
    } else {
      gap.a += a[i++];
    }
  }
  flush();

  const pairs = [];
  for (const g of gaps) {
    const ga = g.a.trim();
    const gb = g.b.trim();
    if (!ga || !gb || isSpace(ga) || isSpace(gb)) continue; // 淨係加字或者刪字，唔算讀錯
    const ca = chars(ga);
    const cb = chars(gb);
    if (ca.length === cb.length && ca.length <= 4) {
      // 長度一樣：逐個字配對（例如「末」→「未」）
      ca.forEach((c, k) => c !== cb[k] && pairs.push({ written: cb[k], misread: c }));
    } else if (ca.length <= 8 && cb.length <= 8) {
      pairs.push({ written: gb, misread: ga });
    }
  }
  return pairs;
}
