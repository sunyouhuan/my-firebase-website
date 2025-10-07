

//old
/**
 * Import function triggers from their respective submodules:
 *
 * const {onCall} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

//const {setGlobalOptions} = require("firebase-functions");
//const {onRequest} = require("firebase-functions/https");
//const logger = require("firebase-functions/logger");

// For cost control, you can set the maximum number of containers that can be
// running at the same time. This helps mitigate the impact of unexpected
// traffic spikes by instead downgrading performance. This limit is a
// per-function limit. You can override the limit for each function using the
// `maxInstances` option in the function's options, e.g.
// `onRequest({ maxInstances: 5 }, (req, res) => { ... })`.
// NOTE: setGlobalOptions does not apply to functions using the v1 API. V1
// functions should each use functions.runWith({ maxInstances: 10 }) instead.
// In the v1 API, each function can only serve one request per container, so
// this will be the maximum concurrent request count.
//setGlobalOptions({ maxInstances: 10 });

// Create and deploy your first functions
// https://firebase.google.com/docs/functions/get-started

// exports.helloWorld = onRequest((request, response) => {
//   logger.info("Hello logs!", {structuredData: true});
//   response.send("Hello from Firebase!");
// });




const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { GoogleGenerativeAI } = require("@google/generative-ai");

// 讓函式可以存取我們設定的秘密金鑰
const geminiApiKey = defineSecret("GEMINI_API_KEY");

exports.askGemini = onCall({ secrets: [geminiApiKey] }, async (request) => {
    // 從前端請求中獲取對話歷史
    const conversationHistory = request.data.history || [];

    // 初始化 Gemini
    const genAI = new GoogleGenerativeAI(geminiApiKey.value());
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });

    // 這是最重要的部分：給 AI 的指令 (Prompt Engineering)
    const systemInstruction = `
        你是一個名為 "MatchAI" 的專業網紅行銷顧問。
        你的任務是透過對話，協助商家客戶定義他們的需求，並最終生成一個結構化的 JSON 物件來建立行銷活動。
        同時，你必須根據客戶的回答提供專業建議。

        對話流程：
        1.  首先，親切地問候並詢問想推廣什麼產品。
        2.  接著，依序詢問以下問題，一次只問一個：
            - 產品的特色或主要賣點是什麼？
            - 目標受眾是誰？(例如：年齡、性別、興趣)
            - 預期達到的曝光次數？
            - 總預算範圍是多少？(NT$)
            - 希望媒合多少位網紅？
        3.  在每個問題之間，根據客戶的回答給出一句簡短的專業建議。例如，如果客戶說預算很低，你可以建議從微型網紅開始。
        4.  當所有問題都問完後，總結客戶的需求，並詢問是否確認送出。
        5.  如果客戶確認，你的最後一條訊息必須包含一個 JSON 物件。

        JSON 格式規範：
        - 當所有資訊都收集完畢，且客戶確認後，你的回覆必須包含一個 JSON 字串。
        - JSON 字串必須用 \`\`\`json 和 \`\`\` 包圍。
        - JSON 物件必須包含以下鍵：productName, productDesc, targetAudience, impressions, budget, influencerCount。
        - 範例: \`\`\`json
          {
            "productName": "酷炫無線耳機",
            "productDesc": "降噪、音質好",
            "targetAudience": "20-35歲的科技愛好者",
            "impressions": 100000,
            "budget": 50000,
            "influencerCount": 10,
            "isComplete": true
          }
          \`\`\`
        - 只有在最後一步才設定 isComplete 為 true。

        風格：專業、友善、循循善誘。不要一次問太多問題。
    `;

    const chat = model.startChat({
        history: [
            { role: "user", parts: [{ text: systemInstruction }] },
            { role: "model", parts: [{ text: "好的，我明白了。我將扮演 MatchAI 行銷顧問的角色。請問您今天想推廣什麼好產品呢？" }] },
            ...conversationHistory // 接上之前的對話
        ],
    });

    const latestUserMessage = conversationHistory.pop().parts[0].text;
    const result = await chat.sendMessage(latestUserMessage);
    const response = await result.response;

    return { text: response.text() };
});