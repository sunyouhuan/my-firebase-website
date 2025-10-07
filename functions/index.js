




const functions = require("firebase-functions");
const { VertexAI } = require("@google-cloud/vertexai");

// 初始化 Vertex AI，它會自動使用函式的內建權限
const vertex_ai = new VertexAI({
  project: process.env.GCLOUD_PROJECT,
  location: "us-central1",
});

const model = "gemini-1.0-pro-001"; // 使用一個穩定的模型版本

// 建立生成模型實例
const generativeModel = vertex_ai.getGenerativeModel({
  model: model,
});

exports.askGemini = functions.https.onCall(async (data, context) => {
  // === 為了除錯，暫時將以下幾行註解掉 ===
  /*
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "The function must be called while authenticated.");
  }
  */
  // === 除錯結束後，若有需要可以再打開 ===
  const conversationHistory = data.history || [];
  if (conversationHistory.length === 0) {
      throw new functions.https.HttpsError("invalid-argument", "Conversation history cannot be empty.");
  }

  // 您的系統指令 (Prompt Engineering)
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

  // 將歷史紀錄轉換為 Vertex AI 需要的格式
  const contents = conversationHistory.map(turn => ({
      role: turn.role === 'model' ? 'model' : 'user',
      parts: turn.parts,
  }));

  // 將系統指令融入第一次對話
  const firstUserMessage = contents.find(c => c.role === 'user');
  if (firstUserMessage) {
      firstUserMessage.parts[0].text = systemInstruction + "\n\n" + firstUserMessage.parts[0].text;
  }
  
  try {
    const chat = generativeModel.startChat({
        history: contents.slice(0, -1), // 傳入不包含最新訊息的歷史
    });

    const latestMessage = contents[contents.length - 1].parts[0].text;
    
    const result = await chat.sendMessage(latestMessage);
    const response = result.response;

    // 加上保護機制，確保 response.candidates 是有效的
    if (!response.candidates || response.candidates.length === 0 || !response.candidates[0].content || !response.candidates[0].content.parts || response.candidates[0].content.parts.length === 0) {
        console.error("Invalid AI response structure:", JSON.stringify(response, null, 2));
        throw new functions.https.HttpsError("internal", "Received an invalid response from the AI service.");
    }
    
    const text = response.candidates[0].content.parts[0].text;

    return { text: text };

  } catch (error) {
    console.error("Vertex AI 呼叫失敗:", error);
    // 如果錯誤不是 HttpsError，則包裝成 HttpsError
    if (error.code && error.message) {
        throw error; // 如果已經是 HttpsError，直接拋出
    }
    throw new functions.https.HttpsError("internal", "呼叫 AI 服務時發生錯誤。");
  }
});