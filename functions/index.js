// functions/index.js
const functions = require("firebase-functions");
const { VertexAI } = require("@google-cloud/vertexai");

// （可選）如果你有用到 Admin SDK，才需要這兩行
// const admin = require("firebase-admin");
// admin.initializeApp();

const vertex = new VertexAI({
  project: process.env.GCLOUD_PROJECT,
  location: "us-central1",
});

const MODEL_NAME = "gemini-1.0-pro-001";

// 你的系統指令（保持只有一份，避免每輪對話重複塞）
const systemInstruction = `
你是一個名為 "MatchAI" 的專業網紅行銷顧問。
你的任務是透過對話，協助商家客戶定義需求，最後輸出 JSON（用 \`\`\`json 包住）。
流程：
1) 先親切問候並詢問想推廣什麼產品。
2) 依序一次只問一個問題：賣點、目標受眾、預期曝光、總預算(NT$)、希望網紅數。
3) 每次提問間給一句精簡專業建議（如預算低→建議先從微網紅開始）。
4) 全部蒐集完後總結並詢問是否確認送出。
5) 客戶確認後，回覆必須包含格式正確的 JSON：
\`\`\`json
{
  "productName": "...",
  "productDesc": "...",
  "targetAudience": "...",
  "impressions": 100000,
  "budget": 50000,
  "influencerCount": 10,
  "isComplete": true
}
\`\`\`
只有在最後一步才設定 isComplete 為 true。
風格：專業、友善、循循善誘，切勿一次問太多。
`.trim();

exports.askGemini = functions.https.onCall(async (data, context) => {
    // --- 1) 讀取並驗證 history（同時相容 historyJSON） ---
    let conversationHistory = Array.isArray(data?.history) ? data.history : [];
    if (!conversationHistory.length && typeof data?.historyJSON === "string") {
      try {
        conversationHistory = JSON.parse(data.historyJSON);
      } catch (e) {
        // ignore，後面驗證會擋
      }
    }
    if (!Array.isArray(conversationHistory) || conversationHistory.length === 0) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Conversation history cannot be empty."
      );
    }

    // --- 2) 轉成 Vertex AI 需要的 contents ---
    const contents = conversationHistory.map((turn) => ({
      role: turn.role === "model" ? "model" : "user",
      parts: (turn.parts || []).map((p) => ({ text: p.text ?? "" })),
    }));

    // --- 3) 系統指令只插一次（第一則 user 前面）---
    const firstUser = contents.find((c) => c.role === "user");
    if (
      firstUser &&
      firstUser.parts &&
      firstUser.parts[0] &&
      typeof firstUser.parts[0].text === "string" &&
      !firstUser.parts[0].text.startsWith(systemInstruction)
    ) {
      firstUser.parts[0].text = `${systemInstruction}\n\n${firstUser.parts[0].text}`;
    }

    // --- 4) 準備 chat 與最新一則訊息 ---
    const generativeModel = vertex.getGenerativeModel({ model: MODEL_NAME });

    // history 只放到「最後一則訊息之前」
    const historyForChat = contents.slice(0, -1);
    const latestMessage = contents[contents.length - 1]?.parts?.[0]?.text ?? "";

    try {
      const chat = generativeModel.startChat({ history: historyForChat });

      // ✅ await 完全置於 async 區塊與 try/catch 內
      const result = await chat.sendMessage(latestMessage);
      const response = result?.response;

      const text =
        response?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

      if (!text) {
        console.error("Invalid AI response:", JSON.stringify(response, null, 2));
        throw new functions.https.HttpsError(
          "internal",
          "Received an invalid response from the AI service."
        );
      }

      return { text };
    } catch (err) {
      console.error("Vertex AI 呼叫失敗:", err);
      if (err instanceof functions.https.HttpsError) throw err;
      throw new functions.https.HttpsError("internal", "呼叫 AI 服務時發生錯誤。");
    }
  });
