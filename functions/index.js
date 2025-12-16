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
        if (providerId === 'instagram') {
            
            // 1. 基礎資料
            const meRes = await axios.get(`https://graph.instagram.com/v21.0/me`, {
                params: {
                    fields: 'id,username,account_type,media_count,followers_count,biography,profile_picture_url',
                    access_token: accessToken
                }
            });

            // 2. 抓取最近 10 篇貼文 (算互動率 & 平均按讚留言)
            let recentMedia = [];
            try {
                const mediaRes = await axios.get(`https://graph.instagram.com/v21.0/me/media`, {
                    params: {
                        fields: 'like_count,comments_count', // 只需抓這兩個欄位計算
                        limit: 10, 
                        access_token: accessToken
                    }
                });
                recentMedia = mediaRes.data.data || [];
            } catch (err) { console.warn("[IG資料] 無法取得貼文:", err.message); }

            // 3. [升級] 抓取月數據 (28天) 並計算日平均
            // 我們嘗試一次抓取 reach, impressions, profile_views 的 28 天數據
            let insightsData = { 
                reach: 0, reach_avg: 0,
                impressions: 0, impressions_avg: 0,
                profile_views: 0, profile_views_avg: 0 
            };
            
            try {
                const monthStatsRes = await axios.get(`https://graph.instagram.com/v21.0/me/insights`, {
                    params: { 
                        metric: 'reach,impressions,profile_views', 
                        period: 'days_28', // 🔥 關鍵：全部抓 28 天
                        access_token: accessToken 
                    }
                });

                if(monthStatsRes.data && monthStatsRes.data.data) {
                    monthStatsRes.data.data.forEach(item => {
                        // 取得 28 天總和
                        const val = item.values[item.values.length - 1].value;
                        
                        if (item.name === 'reach') {
                            insightsData.reach = val;
                            insightsData.reach_avg = Math.round(val / 28); // 算日平均
                        }
                        if (item.name === 'impressions') {
                            insightsData.impressions = val;
                            insightsData.impressions_avg = Math.round(val / 28);
                        }
                        if (item.name === 'profile_views') {
                            insightsData.profile_views = val;
                            insightsData.profile_views_avg = Math.round(val / 28);
                        }
                    });
                }
            } catch (err) { console.warn("[IG資料] 成效數據異常:", err.message); }

            // 4. 受眾輪廓 (維持不變)
            let audienceData = { city: {}, genderAge: {}, country: {} };
            try {
                const demoRes = await axios.get(`https://graph.instagram.com/v21.0/me/insights`, {
                    params: { metric: 'audience_city,audience_gender_age,audience_country', period: 'lifetime', access_token: accessToken }
                });
                if(demoRes.data && demoRes.data.data) {
                    demoRes.data.data.forEach(item => {
                        if (item.name === 'audience_city') audienceData.city = item.values[0].value; 
                        if (item.name === 'audience_gender_age') audienceData.genderAge = item.values[0].value; 
                        if (item.name === 'audience_country') audienceData.country = item.values[0].value;
                    });
                }
            } catch (err) { console.warn("[IG資料] 受眾數據異常:", err.message); }

            // 5. 計算互動率 (ER) 與 假粉率
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

            // 假粉率演算法
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
                media_count: meRes.data.media_count || 0, // 🔥 貼文數在這
                profile_picture_url: meRes.data.profile_picture_url || "",
                biography: meRes.data.biography || "",
                
                insights: insightsData, // 包含 reach, reach_avg...
                audience: audienceData,
                
                advanced_stats: {
                    engagement_rate: realER,
                    fake_follower_rate: fakeRate,
                    avg_likes: avgLikes,
                    avg_comments: avgComments,
                    expected_story_views: Math.round(followers * 0.25)
                }
            };
            
            console.log(`[IG運算] 貼文:${igData.media_count}, ER:${realER}, 觸及:${insightsData.reach}`);
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