const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { genAI } = require("../config");

// AI 行銷顧問 — 使用 Google Gemini API
const askGemini = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "請先登入");
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
  const result = await model.generateContent(request.data.prompt);
  return { response: result.response.text() };
});

module.exports = { askGemini };
