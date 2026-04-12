const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const axios = require("axios");
const FormData = require("form-data");
const { IG_CLIENT_ID, IG_CLIENT_SECRET, IG_REDIRECT_URI } = require("../config");

// Instagram OAuth Token 交換（含 ID 精度修正）
const exchangeIgToken = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "請先登入");
  const code = request.data.code;
  try {
    const formData = new FormData();
    formData.append("client_id", IG_CLIENT_ID);
    formData.append("client_secret", IG_CLIENT_SECRET);
    formData.append("grant_type", "authorization_code");
    formData.append("redirect_uri", IG_REDIRECT_URI);
    formData.append("code", code);

    const tokenRes = await axios.post(
      "https://api.instagram.com/oauth/access_token",
      formData,
      { headers: formData.getHeaders() }
    );
    const shortToken = tokenRes.data.access_token;

    // 確保 User ID 是字串，避免精度丟失
    let igUserId = tokenRes.data.user_id;
    if (typeof igUserId === "number") {
      igUserId = BigInt(igUserId).toString();
    }

    const longTokenRes = await axios.get(
      "https://graph.instagram.com/access_token",
      {
        params: {
          grant_type: "ig_exchange_token",
          client_secret: IG_CLIENT_SECRET,
          access_token: shortToken,
        },
      }
    );

    // 用 Long Token 再抓一次 /me，確保 ID 絕對正確（Graph API 回傳 ID 是字串）
    const meVerify = await axios.get(
      `https://graph.instagram.com/v21.0/me?fields=id&access_token=${longTokenRes.data.access_token}`
    );
    const safeUserId = meVerify.data.id;

    await admin
      .firestore()
      .collection("users")
      .doc(request.auth.uid)
      .collection("tokens")
      .doc("instagram")
      .set({
        accessToken: longTokenRes.data.access_token,
        igUserId: safeUserId,
        provider: "instagram_direct",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

    return { success: true };
  } catch (error) {
    throw new HttpsError("internal", "IG連結失敗");
  }
});

module.exports = { exchangeIgToken };
