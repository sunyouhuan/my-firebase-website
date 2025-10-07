// 引入 Cloud Functions 的核心功能
const { onCall, HttpsError } = require("firebase-functions/v2/https");
// 引入 Firebase Admin SDK，用於未來可能需要存取資料庫等進階操作
const admin = require("firebase-admin");
// 引入 Google AI SDK 和相關工具
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require("@google/generative-ai");

// 初始化 Firebase Admin，讓這個後端函式能認得你的 Firebase 專案
admin.initializeApp();

// 從環境變數中取得你的 Gemini API 金鑰
// 這是最重要的一步，確保金鑰不會外洩
const GEMINI_API_KEY = process.env.GEMINI_KEY;

// --- 主功能：generateContentWithGemini ---
// 這是一個 "onCall" 類型的 Cloud Function，代表它可以被你的前端程式安全地呼叫
exports.generateContentWithGemini = onCall(async (request) => {
    // 檢查使用者是否已經透過 Firebase 登入，增加一層安全性
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "您必須登入才能使用此功能。");
    }

    // 從前端傳來的請求中，取得對話歷史紀錄 (history) 和最新的訊息 (message)
    const { history, message } = request.data;

    // --- Gemini AI 設定 ---
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    // 設定安全過濾等級，避免 AI 產生不當內容
    const safetySettings = [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    ];
    
    // --- 核心互動邏輯 ---
    try {
        // 建立一個新的對話 session，並傳入之前的歷史紀錄
        const chat = model.startChat({
            history: history || [], // 如果沒有歷史紀錄，就傳入空陣列
            safetySettings,
        });

        // 將使用者最新的訊息傳送給 Gemini
        const result = await chat.sendMessage(message);
        const response = result.response;
        
        // 取得 Gemini 回覆的純文字內容
        const text = response.text();

        // 將 Gemini 的回覆傳回給前端
        return { text: text };

    } catch (error) {
        console.error("呼叫 Gemini API 失敗:", error);
        throw new HttpsError("internal", "AI 顧問目前無法連線，請稍後再試。");
    }
});
