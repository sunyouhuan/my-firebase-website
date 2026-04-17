/**
 * sessionLogout — 清除 __session cookie 並重導回首頁
 *
 * 前端登出時 POST 到此端點（或直接 GET 重導）。
 * 由於 __session 是 HttpOnly，前端 JS 無法直接清除，必須透過伺服器端。
 */
const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

/**
 * 從 Cookie header 解析指定名稱的值
 */
function parseCookie(cookieHeader, name) {
  if (!cookieHeader) return "";
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return "";
}

exports.sessionLogout = onRequest({ invoker: "public" }, async (req, res) => {
  // 嘗試撤銷 session（optional: best-effort）
  const sessionCookie = parseCookie(req.headers.cookie, "__session");
  if (sessionCookie) {
    try {
      const decoded = await admin.auth().verifySessionCookie(sessionCookie);
      await admin.auth().revokeRefreshTokens(decoded.sub);
    } catch (_) {
      // cookie 已失效也沒關係，繼續清除
    }
  }

  // 清除 cookie
  res.setHeader(
    "Set-Cookie",
    "__session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax"
  );

  // 302 回登入頁
  res.redirect(302, "/login");
});
