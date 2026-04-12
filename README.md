# InfluenceAI — AI 驅動的網紅行銷平台

InfluenceAI 是一個 AI 驅動的網紅行銷媒合平台，提供商家與網紅之間的智慧配對服務。本專案部署於 **Firebase Hosting**，後端使用 **Firebase Cloud Functions**，資料儲存於 **Cloud Firestore**。

## 目錄

- [功能概覽](#功能概覽)
- [技術架構](#技術架構)
- [專案結構](#專案結構)
- [環境需求](#環境需求)
- [安裝與設定](#安裝與設定)
- [本機開發](#本機開發)
- [部署](#部署)
- [環境變數](#環境變數)

## 功能概覽

| 功能 | 說明 |
|------|------|
| **Google 登入** | 透過 Firebase Authentication 進行 Google OAuth 登入 |
| **角色選擇** | 使用者可選擇「商家」或「網紅」身份 |
| **AI 行銷顧問** | 整合 Google Gemini API，提供 AI 行銷建議 (askGemini) |
| **Instagram 串接** | OAuth 授權後自動抓取 IG 帳號數據、粉絲洞察、互動率 |
| **數據儀表板** | 顯示粉絲數、互動率、受眾分析等 Instagram Insights |
| **深色模式** | 支援 Light / Dark 主題切換 |
| **方案頁面** | 五個 Solution 靜態頁面介紹不同合作方案 |
| **隱私權政策 / 使用條款** | 完整的法律文件頁面 |

## 技術架構

```
前端 (Frontend)
├── HTML / Tailwind CSS / Vanilla JS
├── Firebase SDK v12.3.0 (CDN ESM)
│   ├── firebase-app
│   ├── firebase-auth
│   ├── firebase-firestore
│   ├── firebase-storage
│   └── firebase-functions
└── Chart.js (數據圖表)

後端 (Backend)
├── Firebase Cloud Functions v2 (Node.js 22)
│   ├── askGemini — AI 行銷顧問 (Google Generative AI)
│   ├── exchangeIgToken — Instagram OAuth Token 交換
│   └── fetchInstagramStats — Firestore Trigger 自動抓取 IG 數據
├── Cloud Firestore — 使用者資料與社群數據
└── Firebase Storage — 檔案儲存

部署 (Deployment)
└── Firebase Hosting (influenceai.tw)
```

## 專案結構

```
my-firebase-website/
├── firebase.json              # Firebase 專案設定 (Hosting + Functions + Storage)
├── .firebaserc                # Firebase 專案別名 (test-b493a)
├── storage.rules              # Firebase Storage 安全規則
├── package.json               # 根目錄依賴
├── README.md
│
├── public/                    # 前端靜態檔案 (Firebase Hosting 根目錄)
│   ├── index.html             # 主應用程式 (SPA，含登入/儀表板/AI 顧問)
│   ├── css/                   # 樣式表 (供未來 CSS 抽離使用)
│   ├── js/                    # JavaScript 模組 (供未來 JS 抽離使用)
│   ├── assets/                # 靜態資源
│   │   └── images/            # 圖片資源
│   └── pages/                 # 子頁面
│       ├── privacy.html       # 隱私權政策
│       ├── terms.html         # 使用條款
│       └── solutions/         # 方案介紹頁
│           ├── solution_1.html  # 最新 AI 資訊
│           ├── solution_2.html  # 成功案例
│           ├── solution_3.html  # 關於我們
│           ├── solution_4.html  # 使用指南
│           └── solution_5.html  # 專人客服 / 免費諮詢
│
├── functions/                 # Firebase Cloud Functions (後端)
│   ├── index.js               # 進入點 (匯入並匯出所有 handlers)
│   ├── package.json           # 後端依賴
│   ├── config/                # 設定檔
│   │   └── index.js           # IG / Gemini API 常數與初始化
│   └── handlers/              # 各功能模組
│       ├── askGemini.js       # AI 行銷顧問 (Gemini API)
│       ├── exchangeIgToken.js # Instagram OAuth Token 交換
│       └── fetchInstagramStats.js  # Firestore Trigger 自動抓取 IG 數據
│
└── references/                # 參考資料
    └── codelab-gemini-api-extensions/  # Gemini API Codelab (Next.js 範例)
```

## 環境需求

- **Node.js** >= 22
- **npm** >= 9
- **Firebase CLI** >= 13
  ```bash
  npm install -g firebase-tools
  ```

## 安裝與設定

```bash
# 1. 複製專案
git clone <repository-url>
cd my-firebase-website

# 2. 安裝後端依賴
cd functions
npm install
cd ..

# 3. 登入 Firebase
firebase login

# 4. 確認專案綁定
firebase use default
```

## 環境變數

後端 Cloud Functions 需要以下環境變數：

| 變數名稱 | 說明 |
|----------|------|
| `GOOGLE_APIKEY` | Google Generative AI (Gemini) API Key |

設定方式：
```bash
firebase functions:secrets:set GOOGLE_APIKEY
```

> **注意**：Instagram Client ID / Secret 目前寫在 `functions/index.js` 設定區中。建議未來遷移至環境變數或 Secret Manager。

## 本機開發

```bash
# 啟動 Firebase Emulator (Hosting + Functions + Firestore)
firebase emulators:start

# 僅啟動 Functions Emulator
cd functions
npm run serve
```

Emulator 預設埠：
- Hosting: `http://localhost:5000`
- Functions: `http://localhost:5001`
- Firestore: `http://localhost:8080`

## 部署

```bash
# 部署全部 (Hosting + Functions + Storage Rules)
firebase deploy

# 僅部署前端
firebase deploy --only hosting

# 僅部署後端
firebase deploy --only functions
```

## 相關文件

- `codelab-gemini-api-extensions-main/` — Google Gemini API Extensions Codelab 的 Next.js 範例，可作為擴充參考
- [Firebase 官方文件](https://firebase.google.com/docs)
- [Instagram Graph API](https://developers.facebook.com/docs/instagram-api/)
- [Google Generative AI](https://ai.google.dev/)
