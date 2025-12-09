// === 引入所有需要的模組 (全面使用 v2 語法) ===
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore"); // ✅ 新版資料庫監聽
const logger = require("firebase-functions/logger");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const admin = require("firebase-admin");
const axios = require("axios");

admin.initializeApp();

// 讀取 Gemini API Key
const API_KEY = process.env.GOOGLE_APIKEY;
const genAI = new GoogleGenerativeAI(API_KEY);

// ==========================================
// 功能 1：AI 行銷顧問
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
// 功能 2：自動抓取 Instagram 數據 (v2 版本)
// ==========================================
exports.fetchInstagramStats = onDocumentWritten("users/{userId}/tokens/facebook", async (event) => {
    // ✅ v2 語法修正：從 event 取得資料
    // event.data.after 代表寫入後的新資料
    const snapshot = event.data && event.data.after;
    if (!snapshot) return null; // 如果是被刪除，不做事

    const data = snapshot.data();
    if (!data || !data.accessToken) return null;

    const accessToken = data.accessToken;
    // ✅ v2 語法修正：從 event.params 取得路徑參數
    const userId = event.params.userId;

    console.log(`[IG分析] 開始為用戶 ${userId} 抓取數據...`);

    try {
      // 1. 取得用戶管理的粉絲專頁
      const pagesRes = await axios.get(
        `https://graph.facebook.com/v18.0/me/accounts?access_token=${accessToken}`
      );

      // 2. 找出有連結 Instagram 的粉專
      let instagramId = null;
      for (const page of pagesRes.data.data) {
        const pageRes = await axios.get(
          `https://graph.facebook.com/v18.0/${page.id}?fields=instagram_business_account&access_token=${accessToken}`
        );
        if (pageRes.data.instagram_business_account) {
          instagramId = pageRes.data.instagram_business_account.id;
          console.log(`找到連結的 IG 帳號 ID: ${instagramId}`);
          break;
        }
      }

      if (!instagramId) {
        console.log("錯誤：此 FB 帳號名下的粉專都沒有連結 IG 商業帳號。");
        return null;
      }

      // 3. 抓取詳細數據
      const igRes = await axios.get(
        `https://graph.facebook.com/v18.0/${instagramId}?fields=biography,id,username,profile_picture_url,website,followers_count,media_count&access_token=${accessToken}`
      );

      const igData = igRes.data;
      console.log(`成功抓取數據：${igData.username}, 粉絲數: ${igData.followers_count}`);

      // 4. 存回 Firestore
      await admin.firestore().collection("users").doc(userId).set({
        social_stats: {
            current: {
                totalFans: igData.followers_count,
                avgEr: 0.035, 
                ig: {
                    connected: true,
                    id: igData.id,
                    username: igData.username,
                    followers: igData.followers_count,
                    mediaCount: igData.media_count,
                    avatar: igData.profile_picture_url,
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