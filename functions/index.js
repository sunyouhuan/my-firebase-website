const admin = require("firebase-admin");
admin.initializeApp();

// ==========================================
// Cloud Functions 進入點
// 各功能模組化於 handlers/ 目錄
// ==========================================
const { askGemini } = require("./handlers/askGemini");
const { exchangeIgToken } = require("./handlers/exchangeIgToken");
const { fetchInstagramStats } = require("./handlers/fetchInstagramStats");
const { sessionLogin } = require("./handlers/sessionLogin");
const { sessionLogout } = require("./handlers/sessionLogout");
const { serveDashboard } = require("./handlers/serveDashboard");

exports.askGemini = askGemini;
exports.exchangeIgToken = exchangeIgToken;
exports.fetchInstagramStats = fetchInstagramStats;
exports.sessionLogin = sessionLogin;
exports.sessionLogout = sessionLogout;
exports.serveDashboard = serveDashboard;
