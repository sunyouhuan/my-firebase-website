/**
 * serveDashboard — 驗證 __session cookie 後回傳受保護的 SPA 頁面
 *
 * Firebase Hosting rewrite 將 /app 導向此 Function。
 * 若 cookie 有效 → 回傳 app.html（完整 dashboard SPA）
 * 若 cookie 無效或不存在 → 302 重導回首頁 /
 */
const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

// 在 cold start 時讀取 HTML（快取在記憶體中）
const APP_HTML_PATH = path.join(__dirname, "..", "protected", "app.html");
let appHtmlCache = null;

function getAppHtml() {
  if (!appHtmlCache) {
    appHtmlCache = fs.readFileSync(APP_HTML_PATH, "utf8");
  }
  return appHtmlCache;
}

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

exports.serveDashboard = onRequest({ invoker: "public" }, async (req, res) => {
  if (req.method !== "GET") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  const sessionCookie = parseCookie(req.headers.cookie, "__session");

  if (!sessionCookie) {
    res.redirect(302, "/login");
    return;
  }

  try {
    // 驗證 session cookie（checkRevoked = true）
    await admin.auth().verifySessionCookie(sessionCookie, true);

    // 回傳受保護的 HTML
    res.set("Cache-Control", "private, no-store, no-cache, must-revalidate");
    res.set("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(getAppHtml());
  } catch (error) {
    console.error("serveDashboard auth error:", error.code || error.message);
    // Cookie 無效或已過期 → 清除 cookie 並重導首頁
    res.setHeader(
      "Set-Cookie",
      "__session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax"
    );
    res.redirect(302, "/login");
  }
});
