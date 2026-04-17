/**
 * sessionLogin — 登入後建立 __session cookie
 *
 * 前端在 Firebase Auth 登入成功後，將 idToken POST 到此端點。
 * 後端驗證 idToken 並產生 Session Cookie（有效期 14 天）。
 * Firebase Hosting 只會轉發名為 __session 的 cookie 給 Cloud Functions。
 */
const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

exports.sessionLogin = onRequest({ invoker: "public" }, async (req, res) => {
  // 只接受 POST
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  const idToken = req.body && req.body.idToken;
  if (!idToken || typeof idToken !== "string") {
    res.status(400).json({ error: "Missing or invalid idToken" });
    return;
  }

  try {
    // 驗證 idToken 是否有效且未超過 5 分鐘
    const decoded = await admin.auth().verifyIdToken(idToken);
    const ageMs = Date.now() - decoded.auth_time * 1000;
    if (ageMs > 5 * 60 * 1000) {
      res.status(401).json({ error: "Recent sign-in required" });
      return;
    }

    // 建立 session cookie
    const sessionCookie = await admin.auth().createSessionCookie(idToken, {
      expiresIn: FOURTEEN_DAYS_MS,
    });

    // 設定 __session cookie（Firebase Hosting 唯一轉發的 cookie 名稱）
    const cookieOpts = [
      `__session=${sessionCookie}`,
      `Max-Age=${FOURTEEN_DAYS_MS / 1000}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
    ];
    // 非 localhost 時加 Secure
    const host = req.headers.host || "";
    if (!host.startsWith("localhost") && !host.startsWith("127.0.0.1")) {
      cookieOpts.push("Secure");
    }
    res.setHeader("Set-Cookie", cookieOpts.join("; "));

    res.status(200).json({ status: "success" });
  } catch (error) {
    console.error("sessionLogin error:", error);
    res.status(401).json({ error: "Unauthorized" });
  }
});
