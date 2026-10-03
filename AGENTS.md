# 專案指示

English Buddy：個人用英文陪練，純靜態網頁（HTML/CSS/JavaScript，無建置步驟），部署於 GitHub Pages，手機語音優先。

## 結構
- `index.html`、`style.css`：介面（三個分頁：今日練習／我的紀錄／設定）
- `js/app.js`：流程與事件（每日 10 分鐘傾偈 → 總結 → 跟讀 → 打卡）
- `js/ai.js`：Groq API（對話、Whisper 語音辨識，由瀏覽器直接呼叫）；錄音（MediaRecorder）；朗讀（`speechSynthesis`）
  - 對話模型只可用 Groq 免費方案用得的（`PREFERRED_MODELS`，而家係 `openai/gpt-oss-*`；Llama 已改為企業版專用）
  - 回 404／403 時用 `/models` 自動揀後備模型並記低；gpt-oss 要加 `reasoning_effort: "low"`、`include_reasoning: false`
  - 朗讀兩種引擎（`settings.ttsEngine`）：`browser`（`speechSynthesis`）或 `orpheus`（`canopylabs/orpheus-v1-english`，每次最多 200 字元，要拆段；冇速度參數，用 `playbackRate`；失敗自動轉瀏覽器聲音）
- `js/store.js`：紀錄、記憶、連續打卡、徽章、設定，全部存 `localStorage`
- `js/prompts.js`：所有提示詞；`js/shadowing.js`：跟讀比對（LCS）
- `.github/workflows/daily-reminder.yml`：每朝 07:30（香港時間）經 ntfy 推送提醒

## 規則
- 回覆與註解使用繁體中文（香港用語）；AI 傾偈用英文，總結解釋用繁體中文。
- 改錯方式（都唔可以打斷對話）：
  - AI 回應用 recast 自然講返正確版本，唔可以直接話使用者錯或者講文法（`chatSystemPrompt`）。
  - 💡 每句提示由另一個 LLM 呼叫產生（`tipPrompt`），同回應並行執行，只顯示唔朗讀，可用開關關閉。
  - 詳細改正同解釋放喺結束總結（`summaryPrompt`）。
- API key 由使用者喺「設定」輸入並存喺佢部機嘅 `localStorage`，不得寫入程式碼或 repo。
- 所有插入 HTML 的動態文字必須經 `esc()` 轉義。
- 唔好加建置工具或框架；保持可以直接用任何靜態伺服器開啟。
- 本機預覽：`python -m http.server 8000`，然後開 `http://localhost:8000`（咪需要 localhost 或 https）。
