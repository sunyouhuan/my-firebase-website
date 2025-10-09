// 引入所有需要的模組
const functions = require("firebase-functions");
const { HttpsError, onCall } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const { GoogleGenerativeAI } = require("@google/generative-ai");

// ✅ 使用新的 process.env 方法讀取 API Key
const API_KEY = process.env.GOOGLE_APIKEY;

// 初始化 Google AI SDK
const genAI = new GoogleGenerativeAI(API_KEY);

// 這就是我們的後端 API，取名為 askGemini
exports.askGemini = onCall(async (request) => {
  // 驗證使用者是否是從你的 App 登入後才呼叫，增加安全性
  if (!request.auth) {
    throw new HttpsError(
      "unauthenticated",
      "The function must be called while authenticated.",
    );
  }

  // 從前端接收傳來的訊息 (prompt)
  const userMessage = request.data.prompt;

  if (!userMessage || typeof userMessage !== "string") {
    throw new HttpsError(
      "invalid-argument",
      "The function must be called with a `prompt` argument.",
    );
  }

  logger.info(`收到來自 ${request.auth.uid} 的訊息: ${userMessage}`);

  try {
    // 選擇你要使用的 Google AI 模型
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    // 這裡可以定義 AI 的角色，讓它的回答更符合你的需求
    const fullPrompt = `你是一個專業的網紅行銷顧問，名叫 'MatchAI 顧問'。你的任務是協助品牌主（商家）發想、規劃、並優化他們的網紅行銷活動。請用繁體中文、友善且專業的語氣回答以下用戶的問題：\n\n用戶問題：${userMessage}`;

    const result = await model.generateContent(fullPrompt);
    const response = result.response;
    const text = response.text();

    logger.info("成功從 Gemini 取得回覆。");

    // 將 AI 的回覆傳回給前端
    return { response: text };

  } catch (error) {
    logger.error("呼叫 Gemini API 時發生錯誤:", error);
    throw new HttpsError(
      "internal",
      "呼叫 Gemini API 失敗。",
      error,
    );
  }
});