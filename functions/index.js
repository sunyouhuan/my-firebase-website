const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const admin = require("firebase-admin");
const axios = require("axios");
const FormData = require('form-data'); 

admin.initializeApp();

// ==========================================
// 設定區
// ==========================================
const IG_CLIENT_ID = "1206014388258225";
const IG_CLIENT_SECRET = "8db91dc1159557946f5ffbb07f371a25"; 
const IG_REDIRECT_URI = "https://influenceai.tw/"; 
const API_KEY = process.env.GOOGLE_APIKEY; 
const genAI = new GoogleGenerativeAI(API_KEY);

// ==========================================
// 功能 1：AI 行銷顧問 (askGemini) - 維持不變
// ==========================================
exports.askGemini = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "請先登入");
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
  const result = await model.generateContent(request.data.prompt);
  return { response: result.response.text() };
});

// ==========================================
// 功能 2：交換 Instagram Token (🔧 修正 ID 精度問題)
// ==========================================
exports.exchangeIgToken = onCall(async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "請先登入");
    const code = request.data.code;
    try {
        const formData = new FormData();
        formData.append('client_id', IG_CLIENT_ID);
        formData.append('client_secret', IG_CLIENT_SECRET);
        formData.append('grant_type', 'authorization_code');
        formData.append('redirect_uri', IG_REDIRECT_URI);
        formData.append('code', code);
        
        const tokenRes = await axios.post('https://api.instagram.com/oauth/access_token', formData, { headers: formData.getHeaders() });
        const shortToken = tokenRes.data.access_token;
        
        // 🔥 關鍵修正：確保 User ID 是字串，避免精度丟失
        let igUserId = tokenRes.data.user_id;
        if (typeof igUserId === 'number') {
            igUserId = BigInt(igUserId).toString(); // 嘗試補救，但通常 API 回傳 JSON 時如果是數字就已經來不及了
            // 更好的做法是依靠下面的 /me endpoint 來取得正確 ID
        }

        const longTokenRes = await axios.get('https://graph.instagram.com/access_token', {
            params: { grant_type: 'ig_exchange_token', client_secret: IG_CLIENT_SECRET, access_token: shortToken }
        });

        // 為了保險起見，我們用 Long Token 再去抓一次 /me，確保 ID 絕對正確 (因為 Graph API 的 /me 回傳 ID 是字串)
        const meVerify = await axios.get(`https://graph.instagram.com/v21.0/me?fields=id&access_token=${longTokenRes.data.access_token}`);
        const safeUserId = meVerify.data.id; // 這裡是字串，安全！

        await admin.firestore().collection("users").doc(request.auth.uid).collection("tokens").doc("instagram").set({
            accessToken: longTokenRes.data.access_token,
            igUserId: safeUserId, // 存入安全的 ID
            provider: 'instagram_direct',
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        return { success: true };
    } catch (error) { throw new HttpsError("internal", "IG連結失敗"); }
});

// ==========================================
// 功能 3：自動抓取 Instagram 數據 (🔥 修正 ID 錯誤版)
// ==========================================
exports.fetchInstagramStats = onDocumentWritten("users/{userId}/tokens/{providerId}", async (event) => {
    const snapshot = event.data && event.data.after;
    if (!snapshot) return null;

    const data = snapshot.data();
    const userId = event.params.userId;
    const providerId = event.params.providerId;

    if (providerId !== 'instagram' && providerId !== 'facebook') return null;
    const accessToken = data.accessToken;
    if (!accessToken) return null;

    console.log(`[IG資料抓取] 用戶 ${userId} 開始抓取...`);

    try {
        if (providerId === 'instagram') {
            
            // 1. 取得基礎帳號資訊
            const meRes = await axios.get(`https://graph.instagram.com/v21.0/me`, {
                params: {
                    fields: 'id,username,account_type,media_count,followers_count,biography,profile_picture_url',
                    access_token: accessToken
                }
            });

            // 🔥 關鍵修正：
            // 絕對優先使用 meRes.data.id (API 回傳的字串)，它永遠是正確的。
            // 不要使用 data.igUserId，因為如果資料庫裡存的是壞掉的 Number，就會導致後面全部失敗。
            const igUserId = meRes.data.id; 
            
            console.log(`[ID檢查] 使用的正確ID: ${igUserId}`); // Log 出來確認

            const INSIGHTS_URL = `https://graph.instagram.com/v21.0/${igUserId}/insights`;

            // 2. 定義候選名單
            // 注意：likes, comments 在 User Insights 其實不常支援 day 週期，通常是用在 Media 上
            // 但 reach, profile_views, total_interactions 應該要能抓到
            const CANDIDATE_METRICS = [
                "reach", 
                "profile_views", 
                "total_interactions",
                "accounts_engaged",
                "content_views", // 修正 ID 後，這個可能就會通了！
                "likes", 
                "comments", 
                "shares", 
                "saves",
                "website_clicks"
            ];

            const dayMs = 24 * 60 * 60 * 1000;
            const today0 = new Date(); today0.setHours(0, 0, 0, 0);
            const daysAgo7 = new Date(today0.getTime() - (7 * dayMs));
            
            const sinceTimestamp = Math.floor(daysAgo7.getTime() / 1000);
            const untilTimestamp = Math.floor(today0.getTime() / 1000);

            let rawDataMap = {};

            const fetchPromises = CANDIDATE_METRICS.map(async (metric) => {
                try {
                    const res = await axios.get(INSIGHTS_URL, {
                        params: {
                            metric: metric,
                            period: 'day', 
                            since: sinceTimestamp,
                            until: untilTimestamp,
                            access_token: accessToken
                        }
                    });
                    const values = res.data?.data?.[0]?.values || [];
                    const totalSum = values.reduce((acc, curr) => acc + (curr.value || 0), 0);
                    const latestVal = values.length > 0 ? values[values.length - 1].value : 0;

                    rawDataMap[metric] = {
                        sum_7_days: totalSum,
                        latest_day: latestVal
                    };
                } catch (err) {
                    // 這裡的 Log 會幫你確認哪些 Metric 是真的不支援，哪些是因為 ID 錯了 (現在 ID 對了，錯誤訊息會變)
                    // console.warn(`[略過] ${metric}: ${err?.response?.data?.error?.message}`);
                    rawDataMap[metric] = { error: "Unsupported" };
                }
            });

            await Promise.allSettled(fetchPromises);

            // 3. 處理受眾 (完整版 - 加入城市國家)
            let audienceData = { city: {}, genderAge: {}, country: {}, _available: true };
            try {
                const demoRequests = [
                    { key: 'city', breakdown: 'city' },
                    { key: 'country', breakdown: 'country' },
                    { key: 'genderAge', breakdown: 'gender,age' }
                ];
                await Promise.all(demoRequests.map(async (req) => {
                    try {
                        const res = await axios.get(INSIGHTS_URL, {
                            params: { metric: 'follower_demographics', period: 'lifetime', breakdown: req.breakdown, access_token: accessToken }
                        });
                        const dataPoints = res.data?.data?.[0]?.total_value?.breakdowns?.[0]?.results || [];
                        audienceData[req.key] = dataPoints.reduce((acc, curr) => {
                            audienceData._available = true; // 只要有一個成功就算成功
                            const keyName = curr.dimension_values.join('.');
                            acc[keyName] = curr.value;
                            return acc;
                        }, {});
                    } catch (err) {}
                }));
            } catch (e) { audienceData._available = false; }


            // 4. 計算互動率 (Media)
            let calculatedStats = { er: 0, avgLikes: 0 };
            try {
                const mediaRes = await axios.get(`https://graph.instagram.com/v21.0/me/media`, {
                    params: { fields: 'like_count,comments_count', limit: 20, access_token: accessToken } // 抓多一點樣本
                });
                const posts = mediaRes.data.data || [];
                if (posts.length > 0) {
                    let tLikes = 0, tComms = 0;
                    posts.forEach(p => { tLikes += (p.like_count||0); tComms += (p.comments_count||0); });
                    calculatedStats.avgLikes = Math.round(tLikes / posts.length);
                    calculatedStats.er = (tLikes + tComms) / posts.length / (meRes.data.followers_count || 1);
                }
            } catch(e) {}

            // 5. 寫入 DB
            // 策略：如果有 content_views (18?) 就用，沒有就用 reach (4)
            const finalBrowsing = rawDataMap['content_views']?.sum_7_days || rawDataMap['reach']?.sum_7_days || 0;

            const finalData = {
                id: meRes.data.id, // 確保這裡存的也是字串 ID
                username: meRes.data.username,
                followers: meRes.data.followers_count || 0,
                mediaCount: meRes.data.media_count || 0,
                avatar: meRes.data.profile_picture_url || "",
                
                insights: {
                    browsing_count_week: finalBrowsing, 
                    profile_views_week: rawDataMap['profile_views']?.sum_7_days || 0,
                    reach_day: rawDataMap['reach']?.latest_day || 0,
                    total_interactions_day: rawDataMap['total_interactions']?.latest_day || 0
                },
                
                raw_debug_data: rawDataMap,
                audience: audienceData,
                advanced: {
                    engagement_rate: calculatedStats.er,
                    avg_likes: calculatedStats.avgLikes
                },
                lastUpdated: admin.firestore.FieldValue.serverTimestamp()
            };

            await admin.firestore().collection("users").doc(userId).set({
                social_stats: {
                    current: {
                        totalFans: finalData.followers,
                        avgEr: finalData.advanced.engagement_rate,
                        ig: { connected: true, ...finalData }
                    }
                }
            }, { merge: true });

            return { success: true };
        }
    } catch (error) {
        console.error("Critical Error:", error);
        return null;
    }
});