const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require("@google/generative-ai");

admin.initializeApp();

const GEMINI_KEY = defineSecret("GEMINI_KEY");

exports.generateContentWithGemini = onCall(
  { region: "us-central1", secrets: [GEMINI_KEY] }, // 若改用 asia-east1 就一起改
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "您必須登入才能使用此功能。");

    const apiKey = GEMINI_KEY.value();           // ← 這裡拿到真正的金鑰
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
      console.error("呼叫 Gemini API 失敗:", e);  // 之後能在 Logs 看到真正原因（401 等）
      throw new HttpsError("internal", "AI 顧問目前無法連線，請稍後再試。");
    }
  }
);
