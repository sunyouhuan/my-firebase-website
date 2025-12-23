const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const admin = require("firebase-admin");
const axios = require("axios");
const FormData = require('form-data'); 

admin.initializeApp();


// ✅ 共用：把 Meta/Graph API 回傳的錯誤內容完整印出來（不再只看到 status 400）
function logAxiosError(tag, err) {
  const status = err?.response?.status;
  const data = err?.response?.data;
  console.error(tag, {
    status,
    data: data || err?.message || String(err),
  });
}



// === 設定區 (請確認這些與你的 Meta App 後台一致) ===
const IG_CLIENT_ID = "1206014388258225";
const IG_CLIENT_SECRET = "8db91dc1159557946f5ffbb07f371a25"; // ⚠️ 注意：正式上線建議將此設為環境變數
const IG_REDIRECT_URI = "https://influenceai.tw/"; 

// 設定 Gemini API
const API_KEY = process.env.GOOGLE_APIKEY; 
const genAI = new GoogleGenerativeAI(API_KEY);

// ==========================================
// 功能 1：AI 行銷顧問 (askGemini) - 維持不變
// ==========================================
exports.askGemini = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "請先登入後再使用。");
  }

  const userMessage = request.data.prompt;
  if (!userMessage || typeof userMessage !== "string") {
    throw new HttpsError("invalid-argument", "請輸入有效的訊息。");
  }

  logger.info(`收到用戶 ${request.auth.uid} 的 AI 請求: ${userMessage}`);

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const fullPrompt = `你是一個專業的網紅行銷顧問，名叫 'MatchAI 顧問'。你的任務是協助品牌主（商家）發想、規劃、並優化他們的網紅行銷活動。請用繁體中文、友善且專業的語氣回答以下用戶的問題：\n\n用戶問題：${userMessage}`;

    const result = await model.generateContent(fullPrompt);
    const response = result.response;
    const text = response.text();

    return { response: text };
  } catch (error) {
    logger.error("Gemini API 錯誤:", error);
    throw new HttpsError("internal", "呼叫 Gemini API 失敗。", error);
  }
});

// ==========================================
// 功能 2：交換 Instagram Token (OAuth 流程)
// ==========================================
exports.exchangeIgToken = onCall(async (request) => {
    // 1. 檢查用戶是否登入
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "請先登入");
    }
    
    // 2. 接收前端傳來的 "code"
    const code = request.data.code;
    if (!code) {
        throw new HttpsError("invalid-argument", "缺少授權碼 (code)");
    }

    try {
        console.log(`[Token交換] 用戶 ${request.auth.uid} 開始交換 Token...`);

        // 3. 向 Instagram 交換 "短效 Token" (Short-lived Token)
        const formData = new FormData();
        formData.append('client_id', IG_CLIENT_ID);
        formData.append('client_secret', IG_CLIENT_SECRET);
        formData.append('grant_type', 'authorization_code');
        formData.append('redirect_uri', IG_REDIRECT_URI);
        formData.append('code', code);

        const tokenRes = await axios.post('https://api.instagram.com/oauth/access_token', formData, {
            headers: formData.getHeaders()
        });
        
        const shortToken = tokenRes.data.access_token;
        const igUserId = tokenRes.data.user_id; // 這是 IG 的用戶 ID

        // 4. 將 "短效 Token" 換成 "長效 Token" (Long-lived Token, 效期 60 天)
        const longTokenRes = await axios.get('https://graph.instagram.com/access_token', {
            params: {
                grant_type: 'ig_exchange_token',
                client_secret: IG_CLIENT_SECRET,
                access_token: shortToken
            }
        });
        
        const longToken = longTokenRes.data.access_token;

        // 5. 存入 Firestore (路徑：users/{uid}/tokens/instagram)
        // 這一步會觸發下方的 fetchInstagramStats 函式
        await admin.firestore().collection("users").doc(request.auth.uid).collection("tokens").doc("instagram").set({
            accessToken: longToken,
            igUserId: igUserId,
            provider: 'instagram_direct', // 標記這是新的直連方式
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        console.log(`[Token交換] 成功！已儲存 Token。`);
        return { success: true };

    } catch (error) {
        logger.error("IG Token 交換失敗:", error.response ? error.response.data : error.message);
        throw new HttpsError("internal", "無法連結 Instagram，請稍後再試。");
    }
});

// ==========================================
// 功能 3：自動抓取 Instagram 數據 (🔥 重點修正版)
// ==========================================
exports.fetchInstagramStats = onDocumentWritten("users/{userId}/tokens/{providerId}", async (event) => {
    // 1. 取得觸發事件的資料
    const snapshot = event.data && event.data.after;
    if (!snapshot) return null; // 如果是刪除文件，則不處理

    const data = snapshot.data();
    const userId = event.params.userId;
    const providerId = event.params.providerId;

    // 只處理 instagram 或 facebook 的 token 更新
    if (providerId !== 'instagram' && providerId !== 'facebook') return null;
    
    const accessToken = data.accessToken;
    if (!accessToken) return null;

    console.log(`[IG資料抓取] 開始為用戶 ${userId} 抓取數據 (來源: ${providerId})...`);

    try {
        let igData = {};

        // === 分支 A: 使用新的 Instagram Login (你現在用的方式) ===
        // === 分支 A: 使用新的 Instagram Login (升級版：抓取洞察報告) ===
        // === 分支 A: 使用新的 Instagram Login (全火力升級版) ===
        // === 分支 A: Instagram 登入 (商業戰情室版：含平均值運算) ===
       // === 分支 A: Instagram 登入 (戰情室終極版：昨日 vs 平均) ===
        if (providerId === 'instagram') {
            
            // 1. 基礎資料
            const meRes = await axios.get(`https://graph.instagram.com/v21.0/me`, {
                params: {
                    fields: 'id,username,account_type,media_count,followers_count,biography,profile_picture_url',
                    access_token: accessToken
                }
            });

            // 2. 抓取貼文 (算互動率 & 平均按讚留言)
            let recentMedia = [];
            try {
                const mediaRes = await axios.get(`https://graph.instagram.com/v21.0/me/media`, {
                    params: {
                        fields: 'like_count,comments_count', 
                        limit: 10, 
                        access_token: accessToken
                    }
                });
                recentMedia = mediaRes.data.data || [];
            } catch (err) { console.warn("[IG資料] 無法取得貼文:", err.message); }

                        // 3. ✅ 成效洞察：拆開抓，避免一個 metric 壞掉整包 400
            let insightsData = { 
                reach_day: 0, reach_avg_30: 0,
                impressions_day: 0, impressions_avg_30: 0,
                profile_views_day: 0
            };

            // 你 token 文件裡有存 igUserId（交換 token 時已寫入）
            // 沒有的話就用 meRes.data.id 當備援
            const igUserId = data.igUserId || meRes.data.id;
            const INSIGHTS_URL = `https://graph.instagram.com/v21.0/${igUserId}/insights`;

            // 產生 yesterday / last30days 的 since/until（用秒）
            const dayMs = 24 * 60 * 60 * 1000;
            const today0 = new Date(); today0.setHours(0, 0, 0, 0);
            const yesterday0 = new Date(today0.getTime() - dayMs);
            const last30_0 = new Date(today0.getTime() - 30 * dayMs);

            const sinceYesterday = Math.floor(yesterday0.getTime() / 1000);
            const untilToday = Math.floor(today0.getTime() / 1000);
            const since30 = Math.floor(last30_0.getTime() / 1000);

            async function getOneMetric(metric, period, since, until) {
              const res = await axios.get(INSIGHTS_URL, {
                params: {
                  metric,
                  period,
                  since,
                  until,
                  access_token: accessToken,
                }
              });
              // res.data.data[0] 形式：{ name, period, values:[{value,end_time}...] }
              return res.data?.data?.[0] || null;
            }

            function lastValue(item) {
              const values = item?.values || [];
              const last = values[values.length - 1];
              return typeof last?.value === "number" ? last.value : 0;
            }

            function avgValue(item) {
              const values = (item?.values || [])
                .map(v => (typeof v.value === "number" ? v.value : 0))
                .filter(n => Number.isFinite(n));
              if (!values.length) return 0;
              return Math.round(values.reduce((a,b)=>a+b,0) / values.length);
            }

            // 3A) 昨日 profile_views
            try {
              const pv = await getOneMetric("profile_views", "day", sinceYesterday, untilToday);
              insightsData.profile_views_day = lastValue(pv);
            } catch (err) {
              logAxiosError("[IG資料] profile_views(day) 失敗", err);
            }

            // 3B) 昨日 reach
            try {
              const r = await getOneMetric("reach", "day", sinceYesterday, untilToday);
              insightsData.reach_day = lastValue(r);
            } catch (err) {
              logAxiosError("[IG資料] reach(day) 失敗", err);
            }

            // 3C) 昨日 impressions（如果這個 metric 在你帳號/權限下不支援，就只會這一項失敗，不會拖垮 reach/profile_views）
            try {
              const imp = await getOneMetric("impressions", "day", sinceYesterday, untilToday);
              insightsData.impressions_day = lastValue(imp);
            } catch (err) {
              logAxiosError("[IG資料] impressions(day) 失敗", err);
            }

            // 3D) 近 30 天平均 reach（用 day 序列自己算平均，比 days_28 更不容易踩雷）
            try {
              const r30 = await getOneMetric("reach", "day", since30, untilToday);
              insightsData.reach_avg_30 = avgValue(r30);
            } catch (err) {
              logAxiosError("[IG資料] reach(30d avg) 失敗", err);
            }

            // 3E) 近 30 天平均 impressions
            try {
              const imp30 = await getOneMetric("impressions", "day", since30, untilToday);
              insightsData.impressions_avg_30 = avgValue(imp30);
            } catch (err) {
              logAxiosError("[IG資料] impressions(30d avg) 失敗", err);
            }

            // 4. ✅ 受眾輪廓：先修正你原本的 metric 字串（你現在那行有 ... 一定錯）
            let audienceData = { city: {}, genderAge: {}, country: {}, _available: true };

            async function getAudienceMetric(metric) {
              const res = await axios.get(INSIGHTS_URL, {
                params: {
                  metric,
                  period: "lifetime",
                  access_token: accessToken,
                }
              });
              return res.data?.data?.[0] || null;
            }

            function lifetimeMap(item) {
              // lifetime 常見格式：values[0].value 是一個 map
              const v = item?.values?.[0]?.value;
              return (v && typeof v === "object") ? v : {};
            }

            try {
              try {
                const city = await getAudienceMetric("audience_city");
                audienceData.city = lifetimeMap(city);
              } catch (err) {
                logAxiosError("[IG資料] audience_city 失敗", err);
              }

              try {
                const ga = await getAudienceMetric("audience_gender_age");
                audienceData.genderAge = lifetimeMap(ga);
              } catch (err) {
                logAxiosError("[IG資料] audience_gender_age 失敗", err);
              }

              try {
                const country = await getAudienceMetric("audience_country");
                audienceData.country = lifetimeMap(country);
              } catch (err) {
                logAxiosError("[IG資料] audience_country 失敗", err);
              }

              if (
                Object.keys(audienceData.city || {}).length === 0 &&
                Object.keys(audienceData.genderAge || {}).length === 0 &&
                Object.keys(audienceData.country || {}).length === 0
              ) {
                audienceData._available = false;
              }

            } catch (err) {
              audienceData._available = false;
              logAxiosError("[IG資料] 受眾洞察總流程失敗", err);
            }


            
            // 5. 計算互動率與平均值
            const followers = meRes.data.followers_count || 0;
            let totalInteractions = 0;
            let totalLikes = 0;
            let totalComments = 0;
            let avgLikes = 0;
            let avgComments = 0;
            let realER = 0;

            if (recentMedia.length > 0) {
                recentMedia.forEach(m => {
                    totalLikes += (m.like_count || 0);
                    totalComments += (m.comments_count || 0);
                });
                avgLikes = Math.round(totalLikes / recentMedia.length);
                avgComments = Math.round(totalComments / recentMedia.length);
                totalInteractions = totalLikes + totalComments;
                
                if (followers > 0) {
                    realER = (totalInteractions / recentMedia.length) / followers; 
                }
            }

            // 假粉率
            let fakeRate = 0.15; 
            const benchmarkER = 0.03; 
            if (realER > 0) {
                let adjustment = (benchmarkER - realER) * 5; 
                fakeRate = 0.15 + adjustment;
                if (fakeRate < 0.05) fakeRate = 0.05;
                if (fakeRate > 0.9) fakeRate = 0.9;
            }

            // 6. 打包回傳
            igData = {
                id: meRes.data.id,
                username: meRes.data.username,
                followers_count: followers,
                media_count: meRes.data.media_count || 0,
                profile_picture_url: meRes.data.profile_picture_url || "",
                biography: meRes.data.biography || "",
                
                insights: insightsData, // 裡面有 reach_day, reach_avg_30 等
                audience: audienceData,
                
                advanced_stats: {
                    engagement_rate: realER,
                    fake_follower_rate: fakeRate,
                    avg_likes: avgLikes,
                    avg_comments: avgComments,
                    expected_story_views: Math.round(followers * 0.25)
                }
            };
            
            console.log(`[IG運算] 貼文:${igData.media_count}, 昨日觸及:${insightsData.reach_day}`);
        }
        
        // === 分支 B: 舊有的 FB 連結方式 (保留作為備用) ===
        else if (providerId === 'facebook') {
            // ... (保留原本的邏輯，省略不變動) ...
            // 為了代碼簡潔，若您確定不跑 FB 流程，這段其實可以簡化，但建議先保留避免錯誤
             const pagesRes = await axios.get(
                `https://graph.facebook.com/v18.0/me/accounts?access_token=${accessToken}`
            );
            let instagramId = null;
            for (const page of pagesRes.data.data) {
                const pageRes = await axios.get(
                  `https://graph.facebook.com/v18.0/${page.id}?fields=instagram_business_account&access_token=${accessToken}`
                );
                if (pageRes.data.instagram_business_account) {
                  instagramId = pageRes.data.instagram_business_account.id;
                  break;
                }
            }
            if (!instagramId) return null;
            const igRes = await axios.get(
                `https://graph.facebook.com/v18.0/${instagramId}?fields=biography,id,username,profile_picture_url,website,followers_count,media_count&access_token=${accessToken}`
            );
            igData = igRes.data;
        }

        // 2. 將抓到的豐富資料寫回 Firestore 的使用者文件
        // 前端介面 (HTML) 會監聽這個路徑來更新 UI
        // 2. 將抓到的豐富資料寫回 Firestore 的使用者文件
        await admin.firestore().collection("users").doc(userId).set({
            social_stats: {
                current: {
                    totalFans: igData.followers_count || 0,
                    avgEr: igData.advanced_stats?.engagement_rate || 0, // 更新為真實計算的 ER
                    ig: {
                        connected: true,
                        id: igData.id,
                        username: igData.username,
                        followers: igData.followers_count || 0,
                        mediaCount: igData.media_count,
                        avatar: igData.profile_picture_url || "",
                        bio: igData.biography || "",
                        
                        insights: igData.insights || {}, 
                        audience: igData.audience || {},
                        // 🔥 寫入進階數據
                        advanced: igData.advanced_stats || {},

                        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
                    }
                }
            }
        }, { merge: true }); // 使用 merge: true 避免覆蓋掉用戶的其他資料

        return { success: true };

    } catch (error) {
        console.error("[IG資料抓取] 失敗:", error.response ? error.response.data : error.message);
        // 不拋出錯誤，避免 Cloud Function 無限重試
        return null;
    }
});