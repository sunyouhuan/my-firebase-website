# Instagram Insights 可用 Metrics 表（已排除 Deprecated 與 Facebook Login only）

本表依據 `Ref/Account Insight - Instagram 平台.html` 與 `Ref/Media Insight - Instagram 平台.html` 整理。

## 篩選規則

已移除：

- 所有 deprecated metrics
- 所有 Facebook Login only metrics（`total_comments`, `total_likes`, `total_views`）

## 全域時間與單位說明

- `時間維度`：指出此 metric 可用的 `period` / `timeframe` 型態或特殊時效限制。
- `單位`：
  - `count` = 次數
  - `accounts` = 帳號數（通常是唯一帳號）
  - `percent` = 百分比
  - `time` = 時間長度
- Media insights 一般限制：資料最多延遲 48 小時、最多保留 2 年；Story 類指標通常僅 24 小時內可讀。

## 參數補充說明（period / timeframe / 特殊參數）

### 1) `period` 是什麼

- `period` 用來指定「回傳資料的聚合粒度或週期型態」。
- 常見值：
  - `day`：以日為粒度，常用於 Account 層級趨勢指標。
  - `lifetime`：生命週期累積值或快照值，常見於 Media 單篇內容與人口統計類指標。
- 如果某個 metric 文件明確限制 `period`，就只能用該值（例如很多 Account 指標只允許 `day`）。

### 2) `timeframe` 是什麼

- `timeframe` 是「預設時間窗」，主要搭配人口統計類指標使用。
- 常見值：`last_14_days`, `last_30_days`, `last_90_days`, `this_week`, `this_month`, `prev_month`（注意：`engaged_audience_demographics` 在 v20.0+ 僅支援 `this_month` 和 `this_week`，其餘已停用）。
- 這類指標通常不接受 `since` / `until`，而是直接用 `timeframe` 決定區間。
- 常見於：`follower_demographics`, `engaged_audience_demographics`。

### 3) `since` / `until` 與 `timeframe` 差異

- `since` / `until`：自訂起訖時間（較彈性），常用在 `period=day` 的查詢。
- `timeframe`：平台定義好的固定視窗（較受限），主要給特定 demographic metrics。
- 實務上同一請求通常擇一使用：
  - demographic 類：優先 `timeframe`
  - 一般日指標：優先 `since` / `until`

### 4) 常見特殊參數

| 參數 | 用途 | 常見值/範例 | 注意事項 |
|---|---|---|---|
| `metric_type` | 定義回傳數列型態 | `total_value`, `time_series` | 某些 metric 僅支援其中一種或預設值 |
| `breakdown` | 分維度拆解結果 | `media_product_type`, `follow_type`, `contact_button_type`, `story_navigation_action_type`, `action_type`, `follower_type` | 僅在支援該 breakdown 的 metric 使用，否則會報錯 |
| `timeframe` | 使用預設視窗 | `last_14_days`/`last_30_days`/`last_90_days`/`prev_month`/`this_month`/`this_week` | 多見於 demographic；通常不與 `since/until` 併用 |
| `since` / `until` | 自訂時間區間 | `since=2026-04-01&until=2026-04-30` | 注意時區與資料延遲（最多約 48 小時） |

### 5) 快速判斷怎麼帶參數

- Account 一般互動/觸及：先用 `period=day`，需要趨勢再補 `since/until`。
- Demographics：用 `period=lifetime` + `timeframe`，不要帶 `since/until`。
- Media 單篇內容：多數情境用 `period=lifetime`；若文件有額外限制，以該 metric 規格為準。

## A. Account Metrics（可用）

| Metric | 意義 | 時間維度 | 單位 | 備註 |
|---|---|---|---|---|
| accounts_engaged | 與內容互動的帳號數（含廣告互動） | `period=day` | accounts | `metric_type=total_value`；estimated |
| comments | 貼文/Reels/影片/直播收到的留言數 | `period=day` | count | `metric_type=total_value`；可用 `breakdown=media_product_type`；in development |
| engaged_audience_demographics | 已互動受眾的人口統計（年齡/城市/國家/性別） | `period=lifetime` + `timeframe`（`this_month`/`this_week`） | accounts | 受眾分析；`breakdown=age/city/country/gender`；不支援 `since/until`；互動數不足可能不回傳；`last_14_days`/`last_30_days`/`last_90_days`/`prev_month` 於 v20.0+ 已停用 |
| follows_and_unfollows | 追蹤與取消追蹤（含離開 IG）帳號數 | `period=day` | accounts | `metric_type=total_value`；可用 `breakdown=follow_type` |
| follower_demographics | 粉絲人口統計（年齡/城市/國家/性別） | `period=lifetime` + `timeframe` | accounts | `breakdown=age/city/country/gender`；不支援 `since/until`；粉絲數不足可能不回傳 |
| likes | 貼文/Reels/影片按讚數 | `period=day` | count | `metric_type=total_value`；可用 `breakdown=media_product_type` |
| profile_links_taps | 商家聯絡元件點擊（地址/電話/Email/簡訊） | `period=day` | count | `metric_type=total_value`；可用 `breakdown=contact_button_type` |
| reach | 看過內容的唯一帳號數 | `period=day` | accounts | 支援 `metric_type=total_value,time_series`；可用 `breakdown=media_product_type,follow_type`；estimated |
| replies | Story 回覆數（文字/快速回覆） | `period=day` | count | `metric_type=total_value` |
| reposts | 內容被轉發次數 | `period=day` | count | `metric_type=total_value` |
| saves | 內容被收藏次數 | `period=day` | count | `metric_type=total_value`；可用 `breakdown=media_product_type` |
| shares | 內容被分享次數 | `period=day` | count | `metric_type=total_value`；可用 `breakdown=media_product_type` |
| total_interactions | 互動總數（跨貼文/Story/Reels/影片/直播） | `period=day` | count | `metric_type=total_value`；可用 `breakdown=media_product_type` |
| views | 內容播放/顯示次數（Reels/貼文/Story） | `period=day` | count | `metric_type=total_value`；可用 `breakdown=follower_type,media_product_type`；in development |

## B. Media Metrics（可用）

| Metric | 意義 | 時間維度 | 單位 | 備註 |
|---|---|---|---|---|
| comments | 該媒體物件的留言數 | 依請求 `period`（常見 `lifetime`） | count | 適用 `FEED(posts)`, `REELS` |
| crossposted_views | 影片在 IG+Facebook 跨平台播放總次數 | 依請求 `period` | count | 適用 `REELS`；未分享到 Facebook 可能報錯 |
| facebook_views | 該 IG 媒體在 Facebook 的播放次數 | 依請求 `period` | count | 適用 `FEED(posts)`, `REELS`, `STORY`；未分享到 Facebook 可能報錯 |
| follows | 因此媒體帶來的追蹤數 | 依請求 `period` | accounts | 適用 `FEED(posts)`, `STORY` |
| ig_reels_avg_watch_time | Reels 平均觀看時間 | 依請求 `period` | time | 適用 `REELS` |
| ig_reels_video_view_total_time | Reels 總觀看時間（含重播） | 依請求 `period` | time | 適用 `REELS`；in development |
| likes | 該媒體按讚數 | 依請求 `period` | count | 適用 `FEED(posts)`, `REELS` |
| navigation | Story 導航動作總數（前進/返回/離開/下一則） | 依請求 `period`（常見 `lifetime`） | count | 僅 `STORY`；可用 `breakdown=story_navigation_action_type`；Story metrics 通常 24 小時內可讀 |
| profile_activity | 看完媒體後對個人檔案的操作數 | 依請求 `period`（常見 `lifetime`） | count | 適用 `FEED(posts)`, `STORY`；可用 `breakdown=action_type` |
| profile_visits | 看完媒體後導向 profile 的造訪數 | 依請求 `period` | count | 適用 `FEED(posts)`, `STORY` |
| reach | 看到該媒體的唯一使用者數 | 依請求 `period` | accounts | 適用 `FEED(posts)`, `REELS`, `STORY`；estimated |
| reels_skip_rate | Reels 前 3 秒跳出率 | 依請求 `period` | percent | 適用 `REELS`；estimated + in development |
| replies | Story 回覆總數 | 依請求 `period` | count | 僅 `STORY`；部分地區可能為 0；Story metrics 通常 24 小時內可讀 |
| reposts | 轉發數（扣除已刪除轉發） | 依請求 `period` | count | 適用 `FEED(posts)`, `REELS`, `STORY` |
| saved | 被收藏次數 | 依請求 `period` | count | 適用 `FEED(posts)`, `REELS` |
| shares | 被分享次數 | 依請求 `period` | count | 適用 `FEED(posts)`, `REELS`, `STORY` |
| total_interactions | 互動總數（讚/藏/評/分享，扣除取消與刪除） | 依請求 `period` | count | 適用 `FEED(posts)`, `REELS`, `STORY`；in development |
| views | IG 內播放/觀看次數 | 依請求 `period` | count | 適用 `FEED(posts)`, `REELS`, `STORY`；in development |

## 已明確排除（供追溯）

### Deprecated

- Account: `impressions`
- Media: `plays`, `clips_replays_count`, `ig_reels_aggregated_all_plays_count`, `impressions`, `video_views`

### Facebook Login only

- Media: `total_comments`, `total_likes`, `total_views`
