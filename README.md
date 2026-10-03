# English Buddy 英文陪練（個人版）

每日 10 分鐘，用手機同 AI 朋友用英文傾偈。純網頁 app，**完全免費**。

## 每日流程

1. 朝早 07:30 手機收到提醒（ntfy）。
2. 撳「開始」，Buddy 按你嘅生活同興趣出今日話題，先開口。
3. 撳 🎤 講嘢，講完再撳一下就自動送出。到 8 分鐘左右 Buddy 會自然收尾。改錯有兩種方式，都唔會打斷對話：
   - **Buddy 自然講返正確版本**：你講錯，佢唔會話你錯，而係喺回應入面自然講返正確講法。
     例如你講 "Yesterday I go to Mong Kok"，佢會回 "Oh, you **went** to Mong Kok yesterday? What did you buy?"
   - **💡 每句提示（可開關）**：你每句說話下面會細細個顯示正確寫法同簡短中文解釋。Buddy 唔會讀出嚟，你想睇先睇。
4. 撳「結束並總結」，睇到：
   - 讚賞
   - 3 句改善
   - 發音留意
   - 3 句實用句子
5. 跟讀實用句子，app 會標示可能讀得唔清楚嘅字。
6. 自動打卡：連續日數同徽章會更新，Buddy 亦會記低你講過嘅生活資料，下次出題用得着。

## 架構與成本

| 部分 | 用乜 | 成本 |
|---|---|---|
| App 寄存 | GitHub Pages（靜態網頁） | 免費 |
| AI 對話＋語音辨識 | Groq 免費方案（`openai/gpt-oss-120b` + Whisper；模型停用時會自動換一個用得嘅），由瀏覽器直接呼叫 | 免費 |
| 朗讀 | 手機瀏覽器內置語音；或者 Groq Orpheus（更有感情嘅 AI 聲線，可喺「設定」揀） | 免費／用 Groq 額度 |
| 紀錄、記憶、打卡 | 手機瀏覽器 `localStorage` | 免費 |
| 每朝提醒 | GitHub Actions + ntfy | 免費 |

## 部署步驟

### 1. 攞 Groq API key（2 分鐘）
1. 去 [console.groq.com](https://console.groq.com) 註冊並登入。
2. 去 **API Keys** → **Create API Key**，抄低條 key（`gsk_` 開頭）。
3. 唔好將條 key 放入任何檔案。之後喺手機 app 嘅「設定」輸入就得。

### 2. 放上 GitHub Pages（5 分鐘）
1. 去 github.com，撳 **+** → **New repository**：
   - 名：`english-buddy`
   - 揀 **Public**，因為免費帳戶嘅 GitHub Pages 只支援 public repo。code 入面冇任何密碼或者 key，所以公開都安全。
   - 撳 **Create repository**。
2. 撳 **uploading an existing file**，將以下檔案同資料夾一齊拖入去：
   - `index.html`、`style.css`、`manifest.webmanifest`、`icon.svg`
   - `js` 資料夾
   - `.github` 資料夾
   - `README.md`、`AGENTS.md`、`CLAUDE.md`、`.gitignore`
3. 撳 **Commit changes**。
4. 去 repo 嘅 **Settings** → **Pages**：
   - **Source**：揀 **Deploy from a branch**
   - **Branch**：揀 `main`，資料夾揀 `/ (root)`
   - 撳 **Save**
5. 等 1 至 2 分鐘，頁頂會出現網址，例如 `https://你的帳戶名.github.io/english-buddy/`。

### 3. 設定每朝提醒（3 分鐘）
1. 去 repo 嘅 **Settings** → **Secrets and variables** → **Actions**，加入：

| 分頁 | Name | Value |
|---|---|---|
| Secrets | `NTFY_TOPIC` | 自己諗一個難估嘅名，例如 `eb-7f3k9q2x` |
| Variables | `APP_URL` | 上一步嘅網址 |

2. 手機安裝 **ntfy** app，撳 **+**，訂閱你個 `NTFY_TOPIC`。
3. 想即刻試：去 repo 嘅 **Actions** → **Daily reminder** → **Run workflow**。

### 4. 手機
1. 用手機瀏覽器開你個網址。iPhone 用 Safari，Android 用 Chrome。
2. 第一次開會去「設定」頁，輸入 Groq API key，撳「儲存設定」。
3. 撳瀏覽器嘅「加到主畫面」，之後用起嚟就好似一個 app。
4. 第一次撳 🎤 嗰陣，要容許用咪。

## 之後改 code
喺 GitHub repo 撳 **Add file** → **Upload files**，上載改咗嘅檔案就得。1 至 2 分鐘後 GitHub Pages 會自動更新。

## 本機預覽

```bash
python -m http.server 8000
```

然後開 `http://localhost:8000`。

## 已知限制
- **紀錄只存喺手機**：換手機或者清除瀏覽器資料前，記得去「我的紀錄」→ **⬇️ 匯出** 做備份。
- **iPhone 會清走資料**：如果冇「加到主畫面」又 7 日冇開過，Safari 可能會清走啲資料。加咗去主畫面就冇呢個問題。
- **朗讀聲線**：效果視乎手機內置嘅聲線，可以喺「設定」揀同試聽。iPhone 可以喺系統設定 → 輔助使用 → 朗讀內容 → 聲音，下載質素較好嘅英文聲線。
- **💡 每句提示**：用語音辨識結果判斷，偶然會將辨識錯當成你講錯，參考就好。
- **發音檢查係簡化版**：靠語音辨識有冇聽錯嚟推斷，唔係專業發音評分。
- **Groq 免費方案有用量上限**：個人每日 10 分鐘通常夠用；如果見到「額度用晒」，等一陣再試就得。
- **GitHub 定時任務**：可能遲幾分鐘；repo 60 日冇活動會暫停，要入 Actions 重新啟用。
