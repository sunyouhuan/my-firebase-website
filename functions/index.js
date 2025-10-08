/**
 * 引入 Firebase Cloud Functions 的核心功能。
 * onCall 是一個安全觸發器，讓前端可以像呼叫函式一樣呼叫我們的後端。
 * HttpsError 用於向前端回報標準化的錯誤。
 */
const { onCall, HttpsError } = require("firebase-functions/v2/https");

/**
 * 引入 Google Cloud 的 Vertex AI 專用 SDK。
 * 這是我們與 Gemini AI 溝通的全新、更穩定的方式。
 */
const { VertexAI } = require('@google-cloud/vertexai');

// --- Vertex AI 初始化設定 ---

// 初始化 Vertex AI 客戶端。
// 它會自動使用您 Firebase 專案的內部服務權限，無需手動設定任何 API 金鑰。
const vertex_ai = new VertexAI({
    project: 'test-b493a',        // 請確認這是您的專案 ID
    location: 'us-central1'       // 這個地區必須和您部署函式的地區 'us-central1' 保持一致
});

// 指定一個穩定且廣泛支援的 Vertex AI 模型名稱。
const model = 'gemini-1.0-pro'; 

// 根據指定的模型，初始化一個可以生成內容的 AI 模型實例。
const generativeModel = vertex_ai.getGenerativeModel({
    model: model,
});


/**
 * 導出名為 'generateContentWithGemini' 的 Cloud Function。
 * 前端將會透過這個名稱來呼叫它。
 * { region: "us-central1" } 明確指定函式的部署地區，確保與前端的呼叫一致。
 */
exports.generateContentWithGemini = onCall({ region: "us-central1" }, async (request) => {
    // 安全性檢查：確保呼叫此函式的使用者是透過 Firebase 登入的。
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "您必須登入才能使用此功能。");
    }

    // 從前端傳來的請求中，安全地取出 'history' (對話歷史) 和 'message' (使用者最新訊息)。
    const { history, message } = request.data;

    try {
        // 使用 Vertex AI 的 SDK 來啟動一個對話 session，並載入歷史紀錄。
        const chat = generativeModel.startChat({
            history: history || [],
        });

        // 將使用者的最新訊息傳送給 Gemini 模型進行處理。
        const result = await chat.sendMessage(message);
        
        // 從 Gemini 的回傳結果中解析出純文字內容。
        // Vertex AI 的回傳格式與之前的 SDK 稍有不同，需要從 response.candidates 陣列中取得。
        const response = result.response;
        const text = response.candidates[0].content.parts[0].text;

        // 將 AI 的回覆結果包裝成物件，回傳給前端。
        return { text: text };

    } catch (error) {
        // 如果在呼叫 AI 的過程中發生任何錯誤：
        // 1. 在後台 (Cloud Logging) 印出詳細的錯誤日誌，方便我們除錯。
        console.error("呼叫 Vertex AI 失敗:", error);
        // 2. 向前端回報一個通用的內部錯誤訊息。
        throw new HttpsError("internal", "AI 顧問目前無法連線，請稍後再試。");
    }
});