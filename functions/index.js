const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require("@google/generative-ai");

admin.initializeApp();
const GEMINI_KEY = defineSecret("GEMINI_KEY");

exports.generateContentWithGemini = onCall(
  { region: "us-central1", secrets: [GEMINI_KEY] },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "您必須登入才能使用此功能。");

    const apiKey = GEMINI_KEY.value();
    console.log("GEMINI_KEY length:", (apiKey || "").length);  // 不印出金鑰，只印長度

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    try {
      const chat = model.startChat({
        history: (request.data && request.data.history) || [],
        safetySettings: [
          { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
          { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
          { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
          { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        ],
      });

      const msg = (request.data && request.data.message) || "";
      const result = await chat.sendMessage(msg);
      return { text: result.response.text() };

    } catch (e) {
      // 盡量把下游回覆印出來，之後去 Cloud Logging 一看就知道
      let bodyText = null, status = e?.status || e?.response?.status || null;
      try {
        if (e?.response?.text) bodyText = await e.response.text();
      } catch (_) {}

      console.error("呼叫 Gemini API 失敗:", {
        name: e?.name, message: e?.message, status, body: bodyText
      });

      // 針對常見錯誤，回更友善的代碼（方便前端判斷）
      if (status === 401) throw new HttpsError("unauthenticated", "API 金鑰無效或未提供。");
      if (status === 403) throw new HttpsError("permission-denied", "專案未啟用 API 或金鑰限制不允許。");
      if (status === 404) throw new HttpsError("not-found", "模型或 API 端點不存在（常見於未啟用 API）。");

      throw new HttpsError("internal", "AI 顧問目前無法連線，請稍後再試。");
    }
  }
);
