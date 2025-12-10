// index.js (需補上新的 import)
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const axios = require("axios"); // 確保有安裝 axios
const FormData = require('form-data'); // 可能需要 npm install form-data

// 如果還沒初始化，請保留原本的 admin.initializeApp();

// ==========================================
// 設定：請填入 Meta 後台的資訊 (建議用環境變數，這裡示範先寫死)
// ==========================================
const IG_CLIENT_ID = "790282070637943";
const IG_CLIENT_SECRET = "6d9c4bb8ebd42cd68b5018636f47257a";
const IG_REDIRECT_URI = "https://influenceai.tw/"; // 必須與後台設定完全一致

// ==========================================
// 功能 3 (新): 交換 Instagram Token (這是 Method B 的核心)
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
        // 3. 向 Instagram 交換 "短效 Token"
        // 官方文件: https://developers.facebook.com/docs/instagram-basic-display-api/guides/getting-access-tokens-and-permissions
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
        const igUserId = tokenRes.data.user_id; // 這是 Instagram User ID

        // 4. (選用) 將 "短效 Token" 換成 "長效 Token" (效期 60 天)
        const longTokenRes = await axios.get('https://graph.instagram.com/access_token', {
            params: {
                grant_type: 'ig_exchange_token',
                client_secret: IG_CLIENT_SECRET,
                access_token: shortToken
            }
        });
        
        const longToken = longTokenRes.data.access_token;

        // 5. 存入 Firestore
        // 我們改存到 tokens/instagram 而不是 facebook，以示區別
        await admin.firestore().collection("users").doc(request.auth.uid).collection("tokens").doc("instagram").set({
            accessToken: longToken,
            igUserId: igUserId,
            provider: 'instagram_direct', // 標記這是純 IG 登入
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        return { success: true };

    } catch (error) {
        logger.error("IG Token 交換失敗:", error.response ? error.response.data : error.message);
        throw new HttpsError("internal", "無法連結 Instagram，請稍後再試。");
    }
});

// ==========================================
// 功能 2 (修改版): 自動抓取 Instagram 數據 (支援純 IG 登入)
// ==========================================
// 監聽路徑改為監聽所有 tokens (或是你可以另外寫一個函式監聽 tokens/instagram)
exports.fetchInstagramStats = onDocumentWritten("users/{userId}/tokens/{providerId}", async (event) => {
    const snapshot = event.data && event.data.after;
    if (!snapshot) return null;

    const data = snapshot.data();
    const userId = event.params.userId;
    const providerId = event.params.providerId;

    // 只處理 instagram 或 facebook 的 token
    if (providerId !== 'instagram' && providerId !== 'facebook') return null;
    
    const accessToken = data.accessToken;
    if (!accessToken) return null;

    console.log(`[IG分析] 開始為用戶 ${userId} 抓取數據 (來源: ${providerId})...`);

    try {
        let igData = {};

        if (providerId === 'instagram') {
            // === 情況 A: 純 IG 登入 (Method B) ===
            // 直接呼叫 Instagram Graph API
            // 權限需求: instagram_graph_user_profile, instagram_graph_user_media
            
            // 1. 拿 User Info
            const meRes = await axios.get(`https://graph.instagram.com/me`, {
                params: {
                    fields: 'id,username,account_type,media_count',
                    access_token: accessToken
                }
            });
            
            // 注意：Instagram Basic API 無法直接拿到 "followers_count" (粉絲數)
            // 如果是 "Instagram Login for Business"，你需要用不同的 Endpoint
            // 這裡假設是 Instagram Graph API (Business)
            
            /* 注意：如果你的 App 是申請 "Instagram Login" (非 Basic Display)，
               你會拿到一個 Token，可以用來呼叫 Graph API。
               如果是商業帳號，我們可以嘗試抓取更多資訊。
            */
           
            // 為了簡化，這裡示範 Basic Display 的欄位 (如果不夠，需要切換到 Business Discovery)
            igData = {
                id: meRes.data.id,
                username: meRes.data.username,
                followers_count: 0, // Basic Display API 不給粉絲數，這是硬傷
                media_count: meRes.data.media_count,
                profile_picture_url: "" // Basic API 也不一定給頭像
            };

            // 如果你是用 "Instagram for Business" 的 Scope，你可以嘗試以下：
            try {
                 const businessRes = await axios.get(`https://graph.facebook.com/v18.0/me`, {
                    params: {
                        fields: 'instagram_business_account',
                        access_token: accessToken
                    }
                 });
                 // 這裡邏輯會比較複雜，因為純 IG Login 通常是針對 Basic Display。
                 // 如果要拿粉絲數，通常還是建議走 Facebook Login (Method A) 或是極高權限的 Business Login。
            } catch(e) {
                // ignore
            }

        } else {
            // === 情況 B: 透過 FB 連結 (原本的邏輯) ===
            // ... (保留你原本的 FB 邏輯) ...
            // 為了篇幅，這裡省略原本代碼，你可以直接貼上你原有的 FB 邏輯
            return null; // 暫時跳過
        }

        // 存回 Firestore (部分數據可能為 0)
        await admin.firestore().collection("users").doc(userId).set({
            social_stats: {
                current: {
                    totalFans: igData.followers_count || 0, // 如果抓不到設為 0
                    ig: {
                        connected: true,
                        username: igData.username,
                        id: igData.id,
                        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
                    }
                }
            }
        }, { merge: true });

        return { success: true };

    } catch (error) {
        console.error("抓取 IG 數據失敗:", error.response ? error.response.data : error.message);
        return null;
    }
});