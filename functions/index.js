const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const admin = require("firebase-admin");
const axios = require("axios");
const FormData = require('form-data'); 

admin.initializeApp();

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
// 功能 3：自動抓取 Instagram 數據 (🔥 專家修正版)
// ==========================================
exports.fetchInstagramStats = onDocumentWritten("users/{userId}/tokens/{providerId}", async (event) => {
    const snapshot = event.data && event.data.after;
    if (!snapshot) return null;

    const data = snapshot.data();
    const userId = event.params.userId;
    const providerId = event.params.providerId;

    if (providerId !== 'instagram') return null;
    
    const accessToken = data.accessToken;
    if (!accessToken) return null;

    console.log(`[IG資料抓取] 開始為用戶 ${userId} 抓取數據...`);

    try {
        let igData = {};

        // 1. 基礎資料 (Basic Profile)
        // 必須抓取 account_type 和 media_count
        const meRes = await axios.get(`https://graph.instagram.com/v21.0/me`, {
            params: {
                fields: 'id,username,account_type,media_count,followers_count,biography,profile_picture_url',
                access_token: accessToken
            }
        });

        const userProfile = meRes.data;
        const accountType = userProfile.account_type; // BUSINESS, CREATOR, or PERSONAL
        const followers = userProfile.followers_count || 0;

        console.log(`[IG識別] 帳號類型: ${accountType}, 粉絲數: ${followers}`);

        // 2. 抓取貼文 (Media) - 用於計算互動率
        let recentMedia = [];
        try {
            const mediaRes = await axios.get(`https://graph.instagram.com/v21.0/me/media`, {
                params: {
                    fields: 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count', 
                    limit: 10, // 抓最近 10 篇
                    access_token: accessToken
                }
            });
            recentMedia = mediaRes.data.data || [];
        } catch (err) { 
            console.warn("[IG資料] 無法取得貼文 (可能是權限不足或無貼文):", err.message); 
        }

        // 3. 抓取洞察報告 (Insights) - 🔥 加入邏輯判斷
        let insightsData = { 
            reach_day: 0, reach_avg_30: 0,
            impressions_day: 0, impressions_avg_30: 0,
            profile_views_day: 0 
        };
        
        let audienceData = { city: {}, genderAge: {}, country: {} };

        // ⚠️ 關鍵判斷：只有商業或創作者帳號才能抓 Insight
        if (accountType === 'BUSINESS' || accountType === 'CREATOR') {
            
            // (A) 抓取 每日/週期性 數據 (Reach, Impressions, Profile Views)
            try {
                // 請求昨日數據
                const dayStatsRes = await axios.get(`https://graph.instagram.com/v21.0/me/insights`, {
                    params: { 
                        metric: 'reach,impressions,profile_views', 
                        period: 'day', 
                        access_token: accessToken 
                    }
                });

                // 請求 28 天數據 (用於算平均)
                // 注意: profile_views 不支援 days_28，所以這裡分開抓
                const monthStatsRes = await axios.get(`https://graph.instagram.com/v21.0/me/insights`, {
                    params: { 
                        metric: 'reach,impressions', 
                        period: 'days_28', 
                        access_token: accessToken 
                    }
                });

                // 解析數據
                if(dayStatsRes.data && dayStatsRes.data.data) {
                    dayStatsRes.data.data.forEach(item => {
                        // 取 values 陣列中最後一筆 (最新的一天)
                        const values = item.values || [];
                        const latestVal = values.length > 0 ? values[0].value : 0; // v21.0 通常回傳最新在 index 0 或 length-1，視回傳結構而定，建議檢查
                        // 修正：API v21.0 通常 period=day 只會回傳最近兩天的 array，取最後一個通常是「昨天」
                        const val = values[values.length - 1].value;

                        if (item.name === 'reach') insightsData.reach_day = val;
                        if (item.name === 'impressions') insightsData.impressions_day = val;
                        if (item.name === 'profile_views') insightsData.profile_views_day = val;
                    });
                }

                if(monthStatsRes.data && monthStatsRes.data.data) {
                    monthStatsRes.data.data.forEach(item => {
                        const val = item.values[item.values.length - 1].value; // 28天總和
                        if (item.name === 'reach') insightsData.reach_avg_30 = Math.round(val / 28);
                        if (item.name === 'impressions') insightsData.impressions_avg_30 = Math.round(val / 28);
                    });
                }

            } catch (err) {
                console.error("[IG資料] 抓取成效數據失敗 (Insight API 錯誤):", err.response ? err.response.data : err.message);
            }

            // (B) 抓取 受眾數據 (Audience) - 🔥 必須 > 100 粉絲
            if (followers >= 100) {
                try {
                    const demoRes = await axios.get(`https://graph.instagram.com/v21.0/me/insights`, {
                        params: { 
                            metric: 'audience_city,audience_gender_age,audience_country', 
                            period: 'lifetime', 
                            access_token: accessToken 
                        }
                    });

                    if(demoRes.data && demoRes.data.data) {
                        demoRes.data.data.forEach(item => {
                            if (item.name === 'audience_city') audienceData.city = item.values[0].value; 
                            if (item.name === 'audience_gender_age') audienceData.genderAge = item.values[0].value; 
                            if (item.name === 'audience_country') audienceData.country = item.values[0].value;
                        });
                    }
                } catch (err) {
                    console.warn("[IG資料] 受眾數據無法抓取 (可能剛好滿100人但數據尚未生成):", err.message);
                }
            } else {
                console.log("[IG資料] 粉絲不足 100 人，跳過受眾分析以避免 API 錯誤。");
            }

        } else {
            console.warn("[IG資料] 此帳號為 PERSONAL (個人號)，無法抓取 Insights。請切換為專業帳號。");
        }

        // 4. 計算互動率 (Engagement Rate)
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
                // ER = (平均互動數 / 粉絲數)
                realER = (totalInteractions / recentMedia.length) / followers; 
            }
        }

        // 假粉率估算 (簡單演算法)
        let fakeRate = 0.15; 
        const benchmarkER = 0.03; // 假設基準互動率 3%
        if (realER > 0) {
            let adjustment = (benchmarkER - realER) * 5; 
            fakeRate = 0.15 + adjustment;
            if (fakeRate < 0.05) fakeRate = 0.05;
            if (fakeRate > 0.9) fakeRate = 0.9;
        }

        // 5. 打包資料
        igData = {
            id: userProfile.id,
            username: userProfile.username,
            followers_count: followers,
            media_count: userProfile.media_count || 0,
            profile_picture_url: userProfile.profile_picture_url || "",
            biography: userProfile.biography || "",
            account_type: accountType, // 存下來顯示給 UI 看
            
            insights: insightsData, 
            audience: audienceData,
            recent_media: recentMedia, // 存貼文讓前端可以畫圖
            
            advanced_stats: {
                engagement_rate: realER,
                fake_follower_rate: fakeRate,
                avg_likes: avgLikes,
                avg_comments: avgComments,
                expected_story_views: Math.round(followers * 0.25)
            }
        };

        // 6. 寫回 Firestore
        await admin.firestore().collection("users").doc(userId).set({
            social_stats: {
                current: {
                    totalFans: igData.followers_count || 0,
                    avgEr: igData.advanced_stats?.engagement_rate || 0,
                    ig: {
                        connected: true,
                        ...igData, // 展開所有資料
                        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
                    }
                }
            }
        }, { merge: true });

        console.log(`[IG資料抓取] 成功！用戶:${userProfile.username}, ER:${(realER*100).toFixed(2)}%`);
        return { success: true };

    } catch (error) {
        logger.error("[IG資料抓取] 嚴重失敗:", error);
        return null;
    }
});



