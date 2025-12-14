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
// ==========================================
// 功能 3：自動抓取 Instagram 數據 (🔥 全火力升級版)
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

    console.log(`[IG全火力] 開始為用戶 ${userId} 抓取完整數據...`);

    try {
        // 1. 基礎資料 (Profile)
        const meRes = await axios.get(`https://graph.instagram.com/v21.0/me`, {
            params: {
                fields: 'id,username,name,biography,profile_picture_url,followers_count,media_count',
                access_token: accessToken
            }
        });
        const profile = meRes.data;

        // 2. 媒體資料 (Recent Media) - 抓最近 25 篇貼文
        // 這裡我們會拿到：圖片網址、愛心數、留言數、發文時間、類型(影片/圖片)
        const mediaRes = await axios.get(`https://graph.instagram.com/v21.0/me/media`, {
            params: {
                fields: 'id,caption,media_type,media_url,permalink,thumbnail_url,timestamp,like_count,comments_count',
                limit: 25, 
                access_token: accessToken
            }
        });
        const posts = mediaRes.data.data || [];

        // 3. 帳號洞察 (Account Insights) - 抓過去 30 天的數據
        // 注意：這需要 instagram_business_manage_insights 權限
        let insightsData = { reach: 0, impressions: 0, profile_views: 0 };
        try {
            const insightsRes = await axios.get(`https://graph.instagram.com/v21.0/me/insights`, {
                params: {
                    metric: 'reach,impressions,profile_views',
                    period: 'day', // 以天為單位
                    since: Math.floor(Date.now() / 1000) - 2592000, // 30天前
                    until: Math.floor(Date.now() / 1000),
                    access_token: accessToken
                }
            });
            
            // 簡單加總 30 天的數據
            const iData = insightsRes.data.data;
            iData.forEach(metric => {
                const total = metric.values.reduce((acc, curr) => acc + (curr.value || 0), 0);
                if(metric.name === 'reach') insightsData.reach = total;
                if(metric.name === 'impressions') insightsData.impressions = total;
                if(metric.name === 'profile_views') insightsData.profile_views = total;
            });
        } catch (err) {
            console.warn("[IG洞察] 無法取得 Insight (可能是新帳號數據不足):", err.message);
            // 失敗不影響主流程，保持 0 即可
        }

        // 4. 計算真實互動率 (Average Engagement Rate)
        let totalEngagement = 0;
        posts.forEach(p => {
            totalEngagement += (p.like_count || 0) + (p.comments_count || 0);
        });
        // 互動率 = (總互動 / 貼文數) / 粉絲數
        const avgEngagement = posts.length > 0 ? (totalEngagement / posts.length) : 0;
        const engagementRate = profile.followers_count > 0 ? (avgEngagement / profile.followers_count) : 0;


        // 5. 寫入 Firestore (結構化儲存)
        await admin.firestore().collection("users").doc(userId).set({
            social_stats: {
                current: {
                    totalFans: profile.followers_count || 0,
                    avgEr: engagementRate, // 這是真實算出來的！
                    ig: {
                        connected: true,
                        id: profile.id,
                        username: profile.username,
                        name: profile.name,
                        bio: profile.biography || "",
                        avatar: profile.profile_picture_url || "",
                        followers: profile.followers_count || 0,
                        mediaCount: profile.media_count || 0,
                        
                        // 新增：洞察數據
                        insights: insightsData,
                        
                        // 新增：最近貼文 (只存前 6 篇給前端預覽用，避免文件過大)
                        recentPosts: posts.slice(0, 6),
                        
                        // 新增：圖表用的數據 (最近 25 篇的愛心趨勢)
                        chartData: posts.map(p => ({
                            date: p.timestamp,
                            likes: p.like_count,
                            comments: p.comments_count
                        })).reverse(), // 反轉順序，讓舊的在左邊，新的在右邊

                        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
                    }
                }
            }
        }, { merge: true });

        console.log(`[IG全火力] 成功！粉絲: ${profile.followers_count}, 貼文數: ${posts.length}, 互動率: ${(engagementRate*100).toFixed(2)}%`);
        return { success: true };

    } catch (error) {
        console.error("[IG全火力] 失敗:", error.response ? error.response.data : error.message);
        return null;
    }
});