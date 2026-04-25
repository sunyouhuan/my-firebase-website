# Plan: 修正 IG Dashboard 的資料契約與 API 呼叫

## 問題背景
前端 `updateDashboardWithRealData(igData)` 與 `renderRealCharts(igData)` 讀取的欄位，
與後端 `fetchInstagramStats` 實際寫入 Firestore 的欄位有多處不符。

這次修正不只是後端欄位補齊，還包含：
- Firestore schema 調整
- 前端欄位名稱同步
- Meta API 版本與參數更新
- 文件同步更新

換句話說，這是一個「資料契約修正」而不是單純的後端補欄位。

## 已確認的問題

### [Bug 1] `bio` 未儲存
- 後端 `/me` API 有抓 `biography`，但 `finalData` 沒有寫入
- 前端 `updateDashboardWithRealData(igData)` 讀 `igData.bio`，目前會落到 `(無簡介)`
- 另外頁面上還有 `dash-inf-bio` 顯示點，若要同步顯示 IG 簡介，前端也要一起補

### [Bug 2] `profile_views` 的欄位名稱與資料語意不一致
- 後端目前寫入 `insights.profile_views_week`，值是最近 7 天加總
- 前端目前讀取 `insights.profile_views_day`，而 UI 標示是「昨日 Profile Views」
- 這不是單純 rename，而是資料語意不一致
- 修正時必須二選一：
	- 若 UI 要顯示「昨日」，後端應提供 `profile_views_day = latest_day`
	- 若 UI 要顯示「7 天總和」，前端標題與欄位名應改成 week

### [Bug 3] `insights.reach_avg_30` 後端未計算
- 後端目前只有 `reach_day`，且時間範圍只有 7 天
- 前端會讀取 `insights.reach_avg_30`，因此現在顯示為 0
- 修正方向：將 time-series 抓取範圍改為最近 30 天，計算 `sum_30_days / 30`

### [Bug 4] `impressions` 已廢棄，曝光欄位需要改為 `views`
- 前端目前仍讀 `insights.impressions_avg_30` / `insights.impressions_day`
- Meta 官方已將 `impressions` 廢棄，不能再作為帳號洞察的正式欄位
- 替代方案是改用 `views`
- 這一項不是只改後端即可，前端欄位名也必須一起改成 `views_avg_30` / `views_day`

### [Bug 5] `advanced.avg_comments` 未儲存
- 後端有計算貼文留言總數 `tComms`，但只寫入 `avg_likes`
- 前端會讀 `advanced.avg_comments`，目前顯示 0

### [Bug 6] `advanced.fake_follower_rate` 未計算
- 後端沒有此欄位
- 前端 `renderRealCharts(igData)` 會讀取並顯示進度條
- 這不是 API 原生欄位，而是衍生估算值，應明確視為 internal derived metric

### [Bug 7] `advanced.expected_story_views` 未計算
- 後端沒有此欄位
- 前端 `renderRealCharts(igData)` 會顯示此數字
- 同樣屬於衍生估算值，不是 Meta API 原始欄位

### [Bug 8] `raw_debug_data` 不應存入正式資料
- 後端目前將整包 `rawDataMap` 寫入 Firestore
- 專案內未見前端依賴此欄位
- 這會增加儲存成本，也讓正式 schema 混入 debug 資料，應移除

### [Bug 9] API 版本過舊（v21.0）
- 目前不只 `fetchInstagramStats`，連 token 驗證與 media 讀取也硬編碼 `v21.0`
- 若本次要升版，應統一將 `functions/index.js` 內所有 Instagram Graph API 呼叫升為 `v25.0`

### [Bug 10] Insights 請求缺少 `metric_type`
- 目前 insights time-series 請求未顯式指定 `metric_type`
- 既有解析邏輯依賴 `values[]`
- 修正方向：對 time-series 類指標明確加上 `metric_type: 'time_series'`

### [Bug 11] `follower_demographics` 缺少必要參數
- 目前人口統計請求只有 `period: 'lifetime'`
- 根據官方文件，人口統計需補上 `timeframe: 'last_90_days'`
- 此外應加上 `metric_type: 'total_value'`，以符合目前解析 `total_value.breakdowns` 的方式

### [Bug 12] `content_views` 已廢棄，且與 `views` 欄位語意不可混用
- 目前 `content_views` 還在 `CANDIDATE_METRICS` 中
- 後端用 `content_views?.sum_7_days || reach?.sum_7_days` 填 `browsing_count_week`
- 修正時不能直接把 `browsing_count_week` rename 成 `views_day`
- `7 天瀏覽累計` 與 `單日 views` 是不同語意，必須拆開定義

## 本次修改範圍

### 程式碼
- `functions/index.js`
	- `fetchInstagramStats`
	- 同檔案內所有 Instagram Graph API 版本字串
- `public/index.html`
	- `updateDashboardWithRealData(igData)`
	- `renderRealCharts(igData)`
	- 如需要，同步補上 `dash-inf-bio` 顯示

### 文件
- `FIRESTORE_DATA_DICTIONARY.md`
	- 更新 `social_stats.current.ig` 的實際欄位結構

## 目標資料契約

### 建議保留的欄位
- `bio`
- `insights.reach_day`
- `insights.reach_avg_30`
- `insights.profile_views_week`
- `insights.views_day`
- `insights.views_avg_30`
- `advanced.engagement_rate`
- `advanced.avg_likes`
- `advanced.avg_comments`
- `advanced.fake_follower_rate`
- `advanced.expected_story_views`

### 建議移除的欄位
- `raw_debug_data`
- `insights.browsing_count_week`
- `insights.impressions_day`
- `insights.impressions_avg_30`
- `content_views` 對應的舊內部依賴

## 修改清單
1. 在 `finalData` 加入 `bio: meRes.data.biography || ""`
2. 將所有 Instagram Graph API 路徑從 `v21.0` 升為 `v25.0`，包含 `/me`、`/insights`、`/me/media` 與 token 驗證用 `/me`
3. 將 time-series insights 抓取範圍從 7 天改為 30 天，保留每日值以便同時計算 `latest_day` 與 `avg_30`
4. 對 time-series 類指標請求加入 `metric_type: 'time_series'`
5. 對 `follower_demographics` 請求加入 `timeframe: 'last_90_days'` 與 `metric_type: 'total_value'`
6. 從 `CANDIDATE_METRICS` 移除 `content_views`，改為 `views`
7. 後端新增 `insights.reach_avg_30`
8. 後端新增 `insights.views_day` 與 `insights.views_avg_30`
9. 後端補上 `advanced.avg_comments`
10. 後端補上 `advanced.fake_follower_rate`
11. 後端補上 `advanced.expected_story_views`
12. 移除 `raw_debug_data`
13. 前端將曝光欄位從 `impressions_avg_30 / impressions_day` 改讀 `views_avg_30 / views_day`
14. 前端與後端統一 `profile_views_week` 為「近 7 天總和」，前端顯示文案同步改為週期語意
15. 若保留頁首個人簡介顯示，前端同步更新 `dash-inf-bio`
16. 後端移除 `insights.browsing_count_week`，不再保留舊欄位別名
17. 更新 `FIRESTORE_DATA_DICTIONARY.md`，移除舊欄位並補上新欄位

## 決策

### 已定案
- `fake_follower_rate`：以簡易公式估算，基準 ER 取 `0.03`，結果限制在 `5%` 到 `90%`
- `expected_story_views`：以 `followers × 0.25` 估算
- `metric_type` 策略：
	- 一般 insights 指標用 `time_series`
	- 受眾人口統計用 `total_value`
- API 版本：統一升為 `v25.0`
- `impressions` 不保留舊欄位支援，前後端直接改為 `views`
- `profile_views` 保留「近 7 天總和」語意，欄位名統一為 `profile_views_week`
- `browsing_count_week` 先行移除，不保留過渡欄位

## 實作順序
1. 修改 `functions/index.js`，先讓 Firestore 輸出正確
2. 立即同步修改 `public/index.html` 的欄位讀取與文案
3. 移除 `browsing_count_week` 的後端輸出與任何前端殘留依賴
4. 最後更新 `FIRESTORE_DATA_DICTIONARY.md`
