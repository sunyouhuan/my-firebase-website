# 關鍵業務流程文件

> **專案：** InfluenceAI  
> **最後更新：** 2026-04-14

---

## 流程一：使用者登入 → 進入受保護儀表板

### 觸發
使用者造訪 `https://influenceai.tw/` → JavaScript 自動導向 `/app` → `serveDashboard` 驗證 session 失敗 → 跳轉 `/login`

### 步驟

```
[public/login.html]

1. 使用者選擇登入方式：
   ├─ Email/Password  → signInWithEmailAndPassword()
   ├─ Google OAuth    → signInWithPopup(GoogleAuthProvider)
   └─ 忘記密碼        → sendPasswordResetEmail()

2. Firebase Auth 成功 → onAuthStateChanged(user)

3. user.getIdToken(true) → 取得 ID Token

4. POST /api/session-login  { idToken }
   └─ [sessionLogin.js]
      ├─ verifyIdToken(idToken)
      ├─ 確認 Token 在 5 分鐘內簽發（防 replay attack）
      ├─ createSessionCookie(idToken, { expiresIn: 14天 })
      └─ Set-Cookie: __session=<cookie>; HttpOnly; SameSite=Lax; Secure

5. 前端收到 200 → window.location.href = '/app'

6. GET /app → [serveDashboard.js]
   ├─ 解析 __session cookie
   ├─ verifySessionCookie(cookie, checkRevoked: true)
   ├─ 驗證成功 → 回傳 protected/app.html（SPA 儀表板）
   └─ 驗證失敗 → 302 → /login
```

### 角色
進入 `app.html` 後，前端根據 Firestore 的使用者資料判斷角色：
- **Merchant（廣告主）**：看到品牌活動管理、報表、財務充值頁面
- **Influencer（創作者）**：看到個人數據、受邀列表、提款頁面

---

## 流程二：Instagram 帳號連結 → 數據分析管道

### 觸發
Influencer 在「My Value」頁面點擊「連結 Instagram」

### 步驟

```
[app.html — Influencer My Value 頁]

1. 前端引導使用者至 Instagram OAuth 授權：
   https://api.instagram.com/oauth/authorize
   ?client_id=1206014388258225
   &redirect_uri=https://influenceai.tw/
   &scope=user_profile,user_media,instagram_manage_insights
   &response_type=code

2. Instagram 授權完成 → callback 回 https://influenceai.tw/?code=XXXX

3. 前端前取 URL param code → 呼叫 Callable Function
   exchangeIgToken({ code: "XXXX" })

4. [exchangeIgToken.js]
   ├─ POST api.instagram.com/oauth/access_token
   │    → 取得短期 Token + raw IG user ID
   ├─ GET graph.instagram.com/access_token
   │    (grant_type=ig_exchange_token)
   │    → 取得長期 Token (~60天)
   ├─ GET graph.instagram.com/v21.0/me?fields=id
   │    → 以字串取得真實 igUserId（防 JS BigInt 精度問題）
   └─ Firestore 寫入 users/{uid}/tokens/instagram
        { accessToken, igUserId, provider, updatedAt }

5. Firestore 寫入觸發 onDocumentWritten
   └─ [fetchInstagramStats.js] 自動執行：
      ├─ Guard: 確認 providerId === "instagram" | "facebook"
      ├─ GET /me → username, followers, mediaCount, avatar
      ├─ GET /{igUserId}/insights (11 指標，Promise.allSettled 並行)
      │    reach, profile_views, impressions, total_interactions,
      │    accounts_engaged, accounts_reached, website_clicks,
      │    profile_links_taps, email_contacts, get_directions_clicks,
      │    call_clicks
      ├─ GET follower_demographics (by country, city, gender_age)
      ├─ GET /me/media (最近 20 篇)
      │    → 計算 engagement_rate = (likes+comments)/posts/followers
      │    → 計算 avg_likes
      └─ Firestore 寫入 users/{uid}/social_stats/current/ig
```

### 結果
儀表板即時顯示：
- 追蹤人數、觸及率、互動率圖表
- 受眾地域/性別/年齡長條圖
- 帳號價值評分

---

## 流程三：AI 行銷顧問對話

### 觸發
任何已登入使用者（Merchant 或 Influencer）在 Support / 客服頁面輸入問題

### 步驟

```
[app.html — Support 頁]

1. 使用者輸入行銷問題 → 點擊送出

2. 前端呼叫 Callable Function：
   askGemini({ prompt: "如何提升 CPM？" })

3. [askGemini.js]
   ├─ 驗證 request.auth（未登入 → unauthenticated error）
   ├─ genAI.getGenerativeModel({ model: "gemini-1.5-flash" })
   ├─ model.generateContent(prompt)
   └─ return { response: result.response.text() }

4. 前端接收回應 → 渲染 Markdown 到聊天視窗
```

---

## 流程四：登出

### 步驟

```
[app.html] — 使用者點擊「登出」

1. signOut(auth)  — 清除 Firebase Auth 本地狀態

2. window.location.href = '/api/session-logout'

3. [sessionLogout.js]
   ├─ 解析 __session cookie
   ├─ verifySessionCookie → 取得 uid
   ├─ revokeRefreshTokens(uid)（best-effort，失敗不阻斷）
   ├─ Set-Cookie: __session=; Max-Age=0; HttpOnly（刪除 cookie）
   └─ 302 → /login
```

---

## 路由規則（`firebase.json`）

| 來源路徑 | 目標 | 優先順序 |
|---|---|---|
| `/app` | Cloud Function `serveDashboard` | 1 |
| `/app/**` | Cloud Function `serveDashboard` | 2 |
| `/api/session-login` | Cloud Function `sessionLogin` | 3 |
| `/api/session-logout` | Cloud Function `sessionLogout` | 4 |
| `/api/session-status` | Cloud Function `sessionStatus` | 5 |
| `**` (fallback) | `/index.html` (→ JS redirect `/app`) | 6 |

> **重要：** Firebase Hosting 僅將 `__session` 這個特定名稱的 Cookie 轉發給 Cloud Functions，其他 Cookie 名稱不會被轉發。

---

## Firestore 資料架構

```
users/{userId}
├─ email, displayName, role
│
├─ tokens/
│  └─ instagram
│     ├─ accessToken      (長期 Token, ~60天)
│     ├─ igUserId         (字串，防 BigInt)
│     ├─ provider         ("instagram_direct")
│     └─ updatedAt
│
└─ social_stats/current/
   └─ ig
      ├─ id, username, followers, mediaCount, avatar
      ├─ insights { browsing_count_week, profile_views_week, ... }
      ├─ audience { city, country, genderAge, _available }
      ├─ advanced { engagement_rate, avg_likes }
      ├─ raw_debug_data
      └─ lastUpdated

briefs/{campaignId}
├─ campaignName, productCategory, targetAudience
├─ budget, timeline, status
└─ report/
   ├─ summary.json
   ├─ timeseries.json
   ├─ influencer_leaderboard.json
   └─ ai_insights.json

companies/{companyId}
├─ name, registrationNo (統一編號)
├─ phone, address, website
├─ logoUrl
└─ description
```

---

## 已知安全注意事項

| 問題 | 位置 | 建議 |
|---|---|---|
| `IG_CLIENT_SECRET` 硬編碼於原始碼 | `functions/config/index.js` | 改用 `firebase functions:secrets:set IG_CLIENT_SECRET` |
| Firebase API Key 硬編碼於 HTML | `public/login.html` | Firebase Web API Key 為公開設計，可保留，但應設定 API Key 限制（HTTP referrer） |
| ID Token 新鮮度驗證 | `sessionLogin.js` | 已實作（5分鐘限制），OK |
| BigInt 精度遺失 | `exchangeIgToken.js` | 已用字串取值修正，OK |
