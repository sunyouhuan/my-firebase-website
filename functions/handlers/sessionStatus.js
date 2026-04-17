/**
 * sessionStatus — 輕量級 Session 有效性檢查
 *
 * 前端首頁載入時 GET 此端點，判斷使用者是否已有有效 Session。
 * 回傳 { authenticated: true/false }，不回傳完整 HTML，節省頻寬。
 */
const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

function parseCookie(cookieHeader, name) {
  if (!cookieHeader) return "";
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return "";
}

exports.sessionStatus = onRequest({ invoker: "public" }, async (req, res) => {
  const sessionCookie = parseCookie(req.headers.cookie, "__session");
  if (!sessionCookie) {
    res.json({ authenticated: false });
    return;
  }

  try {
    await admin.auth().verifySessionCookie(sessionCookie, true);
    res.json({ authenticated: true });
  } catch (_) {
    res.json({ authenticated: false });
  }
});
