const { GoogleGenerativeAI } = require("@google/generative-ai");

// ==========================================
// Instagram 設定
// ==========================================
const IG_CLIENT_ID = "1206014388258225";
const IG_CLIENT_SECRET = "8db91dc1159557946f5ffbb07f371a25";
const IG_REDIRECT_URI = "https://influenceai.tw/";

// ==========================================
// Google Generative AI 設定
// ==========================================
const API_KEY = process.env.GOOGLE_APIKEY;
const genAI = new GoogleGenerativeAI(API_KEY);

module.exports = {
  IG_CLIENT_ID,
  IG_CLIENT_SECRET,
  IG_REDIRECT_URI,
  API_KEY,
  genAI,
};
