const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler"); // 引入排程功能
const logger = require("firebase-functions/logger");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const admin = require("firebase-admin");
const axios = require("axios");
const FormData = require('form-data'); 

admin.initializeApp();

// === 設定區 ===
const IG_CLIENT_ID = "1206014388258225";
const IG_CLIENT_SECRET = "8db91dc1159557946f5ffbb07f371a25"; 
const IG_REDIRECT_URI = "https://influenceai.tw/"; 
const API_KEY = process.env.GOOGLE_APIKEY; 
const genAI = new GoogleGenerativeAI(API_KEY);

// ==========================================
// 核心邏輯區：共用的抓取函式 (Core Logic)
// ==========================================
// 這是一個獨立函式，不是 Cloud Function，供其他人呼叫
async function crawlInstagramData(userId, accessToken) {
    console.log(`[核心邏輯] 執行抓取: ${userId}`);
    try {
        // 1. 基礎個資
        const meRes = await axios.get(`https://graph.instagram.com/v21.0/me`, {
            params: { fields: 'id,username,name,biography,profile_picture_url,followers_count,media_count', access_token: accessToken }
        });
        const profile = meRes.data;

        // 2. 媒體資料 (Recent Media)
        const mediaRes = await axios.get(`https://graph.instagram.com/v21.0/me/media`, {
            params: { fields: 'id,caption,media_type,media_url,permalink,thumbnail_url,timestamp,like_count,comments_count', limit: 10, access_token: accessToken }
        });
        let posts = mediaRes.data.data || [];

        // 深挖貼文洞察
        posts = await Promise.all(posts.map(async (post) => {
            try {
                const metric = post.media_type === 'VIDEO' ? 'reach,plays,total_interactions' : 'reach,impressions,total_interactions';
                const insightRes = await axios.get(`https://graph.instagram.com/v21.0/${post.id}/insights`, { params: { metric: metric, access_token: accessToken } });
                const insights = {};
                insightRes.data.data.forEach(i => insights[i.name] = i.values[0].value);
                return { ...post, insights };
            } catch (e) { return { ...post, insights: { reach: 0, impressions: 0 } }; }
        }));

        // 3. 🔥 限時動態 (Stories) 與 歷史存檔 🔥
        let stories = [];
        try {
            const storyRes = await axios.get(`https://graph.instagram.com/v21.0/me/stories`, {
                params: { fields: 'id,media_type,media_url,thumbnail_url,timestamp', access_token: accessToken }
            });
            let rawStories = storyRes.data.data || [];

            stories = await Promise.all(rawStories.map(async (story) => {
                try {
                    const sInsightRes = await axios.get(`https://graph.instagram.com/v21.0/${story.id}/insights`, {
                        params: { metric: 'exits,impressions,reach,replies,taps_forward,taps_back', access_token: accessToken }
                    });
                    const insights = {};
                    sInsightRes.data.data.forEach(i => insights[i.name] = i.values[0].value);
                    return { ...story, insights };
                } catch (e) { return { ...story, insights: {} }; }
            }));

            // 🔥 關鍵：將限動寫入歷史集合 (這會不斷覆蓋舊數據，直到該限動過期)
            if (stories.length > 0) {
                const batch = admin.firestore().batch();
                const historyRef = admin.firestore().collection('users').doc(userId).collection('stories_history');
                stories.forEach(story => {
                    const docRef = historyRef.doc(story.id); // 使用 Story ID 當 Key
                    batch.set(docRef, {
                        ...story,
                        // 加上一個 updateTime，讓你知道這筆數據最後是什麼時候更新的
                        savedAt: admin.firestore.FieldValue.serverTimestamp() 
                    }, { merge: true });
                });
                await batch.commit();
            }
        } catch (e) { console.log("無有效限動"); }

        // 4. 每日觸及趨勢
        let dailyTrend = [];
        try {
            const dailyRes = await axios.get(`https://graph.instagram.com/v21.0/me/insights`, {
                params: { metric: 'reach', period: 'day', since: Math.floor(Date.now()/1000)-2592000, until: Math.floor(Date.now()/1000), access_token: accessToken }
            });
            dailyTrend = dailyRes.data.data[0].values.map(v => ({ date: v.end_time, value: v.value }));
        } catch (e) {}

        // 5. 人口統計
        let demographics = { gender_age: {}, city: {} };
        try {
            const demoRes = await axios.get(`https://graph.instagram.com/v21.0/me/insights`, {
                params: { metric: 'audience_gender_age,audience_city', period: 'lifetime', access_token: accessToken }
            });
            demoRes.data.data.forEach(item => {
                if(item.name === 'audience_gender_age') demographics.gender_age = item.values[0].value; 
                else if (item.name === 'audience_city') demographics.city = item.values[0].value;
            });
        } catch (e) {}

        // 6. 計算
        let totalEngagement = 0;
        posts.forEach(p => totalEngagement += (p.like_count || 0) + (p.comments_count || 0));
        const er = profile.followers_count > 0 ? ((posts.length>0?totalEngagement/posts.length:0) / profile.followers_count) : 0;

        // 7. 寫入主文件
        await admin.firestore().collection("users").doc(userId).set({
            social_stats: {
                current: {
                    totalFans: profile.followers_count || 0,
                    avgEr: er,
                    ig: {
                        connected: true,
                        id: profile.id,
                        username: profile.username,
                        name: profile.name,
                        bio: profile.biography || "",
                        avatar: profile.profile_picture_url || "",
                        followers: profile.followers_count || 0,
                        mediaCount: profile.media_count || 0,
                        insights: { reach: 0 },
                        dailyTrend: dailyTrend,
                        demographics: demographics,
                        recentPosts: posts,
                        activeStories: stories,
                        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
                    }
                }
            }
        }, { merge: true });

        return true;
    } catch (error) {
        console.error(`[Core] 抓取失敗 (${userId}):`, error.message);
        return false;
    }
}

// ==========================================
// Cloud Functions 導出區
// ==========================================

// 1. AI 顧問
exports.askGemini = onCall(async (request) => {
    // ... (維持原本不變) ...
    // 請保留原本的內容
    if (!request.auth) throw new HttpsError("unauthenticated", "Login required");
    // ...略 (請保留原本代碼)
    return { response: "AI功能暫略" }; // 這裡為了簡潔省略，請用原本的代碼
});

// 2. 交換 Token
exports.exchangeIgToken = onCall(async (request) => {
    // ... (維持原本不變) ...
    // 請保留原本的內容
    if (!request.auth) throw new HttpsError("unauthenticated", "Login required");
    // ... (中間省略，請保留原本代碼)
    // 這裡只是示意，請確保你的 index.js 裡這段是完整的
    return { success: true };
});

// 3. [手動/被動觸發] 當 Token 更新時，執行一次抓取
exports.fetchInstagramStats = onDocumentWritten("users/{userId}/tokens/{providerId}", async (event) => {
    const snapshot = event.data && event.data.after;
    if (!snapshot) return null;
    const data = snapshot.data();
    if (event.params.providerId !== 'instagram') return null;
    
    // 呼叫共用邏輯
    await crawlInstagramData(event.params.userId, data.accessToken);
    return { success: true };
});

// 4. 🔥 [自動排程] 每小時自動更新所有用戶的數據 🔥
// 注意：這需要 Blaze (付費) 方案才能啟用 Schedule 功能 (但免費額度內通常夠用)
exports.scheduledInstagramUpdate = onSchedule("every 60 minutes", async (event) => {
    console.log("⏰ 定時任務啟動：開始更新所有 IG 用戶數據...");
    
    // 1. 找出所有有 IG token 的用戶
    // 註：這是一個 Collection Group Query 的簡化版，或直接遍歷 users
    // 為了效能，我們假設 token 存在 users/{uid}/tokens/instagram
    
    // 取得所有 users
    const usersSnap = await admin.firestore().collection('users').get();
    
    const updatePromises = [];

    for (const userDoc of usersSnap.docs) {
        const userId = userDoc.id;
        // 讀取該用戶的 IG token
        const tokenSnap = await admin.firestore().collection('users').doc(userId).collection('tokens').doc('instagram').get();
        
        if (tokenSnap.exists) {
            const accessToken = tokenSnap.data().accessToken;
            // 加入排程佇列
            updatePromises.push(crawlInstagramData(userId, accessToken));
        }
    }

    // 等待所有更新完成
    await Promise.all(updatePromises);
    console.log(`⏰ 定時任務結束，共更新了 ${updatePromises.length} 位用戶。`);
});