// functions/index.js

const { onCall } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { VertexAI } = require("@google-cloud/vertexai");
const logger = require("firebase-functions/logger");

// 初始化 Firebase Admin SDK
initializeApp();

// 在這裡定義 AI 模型的初始化設定
const project = "test-b493a"; // 換成您的 Project ID
const location = "us-central1"; // 或是您使用的地區
const textModel = "gemini-1.0-pro"; // 您可以選用 Gemini 模型

const vertex_ai = new VertexAI({ project: project, location: location });
const generativeModel = vertex_ai.getGenerativeModel({
    model: textModel,
    generation_config: {
        "max_output_tokens": 2048,
        "temperature": 0.5, // 調整溫度可改變創意程度，0-1 之間
        "top_p": 1,
    },
    // 設定安全過濾，可以根據需求調整
    safety_settings: [
        { "category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_MEDIUM_AND_ABOVE" },
        { "category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_MEDIUM_AND_ABOVE" },
        { "category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_MEDIUM_AND_ABOVE" },
        { "category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_MEDIUM_AND_ABOVE" }
    ],
});

// 建立一個可呼叫的 Cloud Function，名稱為 "callGemini"
exports.callGemini = onCall(async (request) => {
    // 從前端請求中獲取使用者傳來的訊息
    const userMessage = request.data.message || "";
    logger.info("收到的訊息:", userMessage);

    if (!userMessage) {
        logger.error("錯誤：沒有收到訊息");
        return { error: "錯誤：訊息內容不得為空。" };
    }

    // 幫 AI 設定一個角色，讓它的回覆更專業
    const systemPrompt = "你是一位專業的網紅行銷顧問，在一個名為 MatchAI 的平台上服務。你的任務是協助商家（使用者）構思、規劃並優化他們的網紅行銷活動。請用繁體中文、親切且專業的語氣回答問題。";

    const prompt = `${systemPrompt}\n\n使用者問：${userMessage}`;

    try {
        // 將 prompt 送給 Vertex AI
        const resp = await generativeModel.generateContent(prompt);
        const modelResponse = resp.response;
        const aiText = modelResponse.candidates[0].content.parts[0].text;

        logger.info("AI 回覆:", aiText);

        // 將 AI 的回覆傳回給前端
        return { response: aiText };

    } catch (error) {
        logger.error("Vertex AI 呼叫失敗:", error);
        return { error: "抱歉，AI 顧問現在有點忙，請稍後再試。" };
    }
});