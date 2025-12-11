// functions/index.js 完整修正版

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const admin = require("firebase-admin");
const axios = require("axios");
const FormData = require('form-data'); 

admin.initializeApp();

// === 設定區 (請填入你的 Meta 後台資訊) ===

const IG_CLIENT_ID = "1206014388258225";
const IG_CLIENT_SECRET = "04d790448d03c01fa3bfb99bddce8fda"; 
// ✅ 修正：必須與 Meta 後台設定完全一致，不能有參數，也不能是長網址
const IG_REDIRECT_URI = "https://influenceai.tw/"; 

// 讀取 Gemini API Key
const API_KEY = process.env.GOOGLE_APIKEY; 
const genAI = new GoogleGenerativeAI(API_KEY);

// ==========================================
// 功能 1：AI 行銷顧問 (askGemini)
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
// 功能 2 (修正版)：交換 Token (改為走 Facebook 通道)
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
        // 3. ✅ 修正：向 Facebook Graph API 交換 Token (因為前端改用了 Facebook Login)
        // 這是取得 IG 商業帳號權限的唯一正確方式
        const tokenRes = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
            params: {
                client_id: IG_CLIENT_ID,
                client_secret: IG_CLIENT_SECRET,
                redirect_uri: IG_REDIRECT_URI, // 必須是 https://influenceai.tw/
                code: code
            }
        });
        
        const accessToken = tokenRes.data.access_token;
        // Facebook 回傳的通常已經是長效 Token (60天)，不需要再換一次

        // 4. 存入 Firestore (存到 tokens/facebook)
        // 改存為 facebook 是因為這個 Token 屬於 Facebook 體系，可以用來管理 FB 粉專和連結的 IG
        await admin.firestore().collection("users").doc(request.auth.uid).collection("tokens").doc("facebook").set({
            accessToken: accessToken,
            provider: 'facebook', // 標記來源
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        return { success: true };

    } catch (error) {
        logger.error("Token 交換失敗:", error.response ? error.response.data : error.message);
        throw new HttpsError("internal", "無法連結 Instagram，請稍後再試。");
    }
});

// ==========================================
// 功能 3：自動抓取 Instagram 數據 (配合 Facebook Token)
// ==========================================
exports.fetchInstagramStats = onDocumentWritten("users/{userId}/tokens/{providerId}", async (event) => {
    const snapshot = event.data && event.data.after;
    if (!snapshot) return null;

    const data = snapshot.data();
    const userId = event.params.userId;
    const providerId = event.params.providerId;

    // 只處理 facebook (新的流程) 或 instagram (舊流程相容)
    if (providerId !== 'instagram' && providerId !== 'facebook') return null;
    
    const accessToken = data.accessToken;
    if (!accessToken) return null;

    console.log(`[IG分析] 開始為用戶 ${userId} 抓取數據 (來源: ${providerId})...`);

    try {
        let igData = {};

        if (providerId === 'facebook') {
            // === 情況 B: 透過 FB 連結 (正確的 IG 商業帳號流程) ===
            
            // 1. 先抓用戶管理的粉絲專頁
            const pagesRes = await axios.get(
                `https://graph.facebook.com/v18.0/me/accounts?access_token=${accessToken}`
            );

            let instagramId = null;
            // 2. 遍歷粉專，找出有連結 IG 商業帳號的那個
            for (const page of pagesRes.data.data) {
                const pageRes = await axios.get(
                  `https://graph.facebook.com/v18.0/${page.id}?fields=instagram_business_account&access_token=${accessToken}`
                );
                if (pageRes.data.instagram_business_account) {
                  instagramId = pageRes.data.instagram_business_account.id;
                  break; // 找到了！
                }
            }

            if (!instagramId) {
                console.log("此 Facebook 帳號下沒有連結 Instagram 商業帳號");
                return null;
            }

            // 3. 用這個 IG ID 去抓詳細數據
            const igRes = await axios.get(
                `https://graph.facebook.com/v18.0/${instagramId}?fields=biography,id,username,profile_picture_url,website,followers_count,media_count&access_token=${accessToken}`
            );
            igData = igRes.data;

        } else if (providerId === 'instagram') {
            // === 情況 A: 純 IG 登入 (Basic Display API - 舊版/非商業) ===
            // 備註：這個分支在新流程下不會被觸發，保留僅作相容
            const meRes = await axios.get(`https://graph.instagram.com/me`, {
                params: {
                    fields: 'id,username,account_type,media_count',
                    access_token: accessToken
                }
            });
            
            igData = {
                id: meRes.data.id,
                username: meRes.data.username,
                followers_count: 0, 
                media_count: meRes.data.media_count,
                profile_picture_url: "" 
            };
        }

        // 存回 Firestore
        await admin.firestore().collection("users").doc(userId).set({
            social_stats: {
                current: {
                    totalFans: igData.followers_count || 0,
                    avgEr: 0.035, // 模擬數據
                    ig: {
                        connected: true,
                        id: igData.id,
                        username: igData.username,
                        followers: igData.followers_count || 0,
                        mediaCount: igData.media_count,
                        avatar: igData.profile_picture_url || "",
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