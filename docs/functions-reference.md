# Cloud Functions 參照文件

> **專案：** InfluenceAI (`test-b493a`)  
> **Runtime：** Node.js 22 (Firebase Functions v2)  
> **入口：** `functions/index.js`

---

## 函式清單

| # | Export 名稱 | 觸發類型 | HTTP 路徑 / Firestore 路徑 | Handler 檔案 | 說明 |
|---|---|---|---|---|---|
| 1 | `askGemini` | `onCall` (需 Auth) | — | `handlers/askGemini.js` | Gemini AI 行銷顧問 |
| 2 | `exchangeIgToken` | `onCall` (需 Auth) | — | `handlers/exchangeIgToken.js` | Instagram OAuth Token 兩段式交換 |
| 3 | `fetchInstagramStats` | `onDocumentWritten` | `users/{userId}/tokens/{providerId}` | `handlers/fetchInstagramStats.js` | Firestore 觸發，自動抓取 IG 數據 |
| 4 | `sessionLogin` | `onRequest` POST | `/api/session-login` | `handlers/sessionLogin.js` | 建立 `__session` Cookie (14天) |
| 5 | `sessionLogout` | `onRequest` GET | `/api/session-logout` | `handlers/sessionLogout.js` | 清除 Cookie + redirect `/login` |
| 6 | `sessionStatus` | `onRequest` GET | `/api/session-status` | `handlers/sessionStatus.js` | 輕量 session 驗證查詢 (JSON) |
| 7 | `serveDashboard` | `onRequest` GET | `/app`, `/app/**` | `handlers/serveDashboard.js` | 驗證 session，回傳 `protected/app.html` |

---

## 各函式詳細說明

### 1. `askGemini`

- **觸發：** Firebase Callable Function
- **驗證：** 需要登入（未登入回傳 `unauthenticated` error）
- **外部服務：** Google Generative AI (Gemini 1.5 Flash)
- **輸入：** `request.data.prompt` — 行銷問題字串
- **輸出：** `{ response: "<Gemini 生成文字>" }`
- **環境變數：** `GOOGLE_APIKEY`（於 `config/index.js` 讀取）

---

### 2. `exchangeIgToken`

- **觸發：** Firebase Callable Function
- **驗證：** 需要登入
- **外部服務：**
  - `https://api.instagram.com/oauth/access_token` — 短期 Token 交換
  - `https://graph.instagram.com/access_token` — 長期 Token 交換
  - `https://graph.instagram.com/v21.0/me` — 驗證真實 igUserId（防 BigInt 精度遺失）
- **輸入：** `request.data.code` — Instagram OAuth callback 中的授權碼
- **輸出：** `{ success: true }` 或 `HttpsError("internal", "IG連結失敗")`
- **Firestore 寫入：** `users/{uid}/tokens/instagram`

```js
{
  accessToken: String,   // 長期 Token (~60天)
  igUserId: String,      // 字串型態，防止 BigInt 轉換
  provider: "instagram_direct",
  updatedAt: Timestamp
}
```

- **Config（`config/index.js`）：**

```js
IG_CLIENT_ID = "1206014388258225"
IG_CLIENT_SECRET = "8db91dc1159557946f5ffbb07f371a25"  // ⚠️ 建議改用 Secret Manager
IG_REDIRECT_URI = "https://influenceai.tw/"
```

---

### 3. `fetchInstagramStats`

- **觸發：** `onDocumentWritten` — `users/{userId}/tokens/{providerId}` 文件建立/更新時觸發
- **Guard：** 僅處理 `providerId === "instagram"` 或 `"facebook"`
- **外部服務：** Instagram Graph API v21.0

| API 呼叫 | 用途 |
|---|---|
| `GET /me` | 帳號基本資料（followersCount, mediaCount, biography, avatar） |
| `GET /{igUserId}/insights` | 11 個指標（reach, profile_views, total_interactions 等），並行抓取 |
| `GET follower_demographics` | 受眾分佈（國家/城市/性別年齡） |
| `GET /me/media` | 最近 20 篇貼文，計算平均 ER 和按讚數 |

- **Firestore 寫入：** `users/{userId}/social_stats/current/ig`

```js
{
  id: String,                    // IG user ID
  username: String,
  followers: Number,
  mediaCount: Number,
  avatar: String,                // profile_picture_url

  insights: {
    browsing_count_week: Number,
    profile_views_week: Number,
    reach_day: Number,
    total_interactions_day: Number,
    // ... 其餘指標
  },

  audience: {
    city: { "Taipei": 12000, ... },
    country: { "Taiwan": 35000, ... },
    genderAge: { "F.18-24": 5000, ... },
    _available: Boolean
  },

  advanced: {
    engagement_rate: Number,   // ER = (likes + comments) / posts / followers
    avg_likes: Number
  },

  raw_debug_data: Object,       // 完整 API 回應（除錯用）
  lastUpdated: Timestamp
}
```

---

### 4. `sessionLogin`

- **觸發：** HTTP POST `/api/session-login`
- **驗證：** 公開端點，但驗證 ID Token 新鮮度（需在 5 分鐘內簽發）
- **輸入：** `req.body.idToken` — Firebase Auth ID Token
- **Cookie：**

| 屬性 | 值 |
|---|---|
| 名稱 | `__session` |
| Max-Age | 14 天 |
| Flags | `HttpOnly`, `Path=/`, `SameSite=Lax`, `Secure`（非 localhost） |

- **輸出：**
  - `200 { status: "success" }` — 成功
  - `400` — 缺少 idToken
  - `401` — Token 過期或無效

---

### 5. `sessionLogout`

- **觸發：** HTTP GET (或 POST) `/api/session-logout`
- **行為：**
  1. 解析 `__session` cookie，撤銷 refresh token（best-effort）
  2. `Set-Cookie: __session=; Max-Age=0` 刪除 cookie
  3. `302 → /login`

---

### 6. `sessionStatus`

- **觸發：** HTTP GET `/api/session-status`
- **行為：** 驗證 `__session` cookie（`checkRevoked: true`）
- **輸出：** `{ authenticated: true | false }`
- **用途：** 前端頁面載入時快速判斷是否已登入

---

### 7. `serveDashboard`

- **觸發：** HTTP GET `/app` 及 `/app/**`
- **行為：**
  1. 驗證 `__session` cookie（`checkRevoked: true`）
  2. 有效 → 回傳 `protected/app.html`（首次讀取後 in-memory 快取）
  3. 無效/過期 → 清除壞 cookie + `302 → /login`
- **回應 Headers：** `Cache-Control: private, no-store, no-cache, must-revalidate`

---

## 外部依賴總覽

| 套件 | 版本 | 用途 |
|---|---|---|
| `firebase-admin` | 13.6.0 | Firestore、Auth Admin SDK |
| `@google/generative-ai` | 0.24.1 | Gemini API |
| `axios` | 1.13.2 | Instagram HTTP 請求 |
| `form-data` | 4.0.5 | Instagram token 交換表單 |
