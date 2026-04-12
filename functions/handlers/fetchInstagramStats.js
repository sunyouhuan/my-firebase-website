const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");
const axios = require("axios");

// Firestore Trigger：當 tokens 文件寫入時，自動抓取 Instagram 數據
const fetchInstagramStats = onDocumentWritten(
  "users/{userId}/tokens/{providerId}",
  async (event) => {
    const snapshot = event.data && event.data.after;
    if (!snapshot) return null;

    const data = snapshot.data();
    const userId = event.params.userId;
    const providerId = event.params.providerId;

    if (providerId !== "instagram" && providerId !== "facebook") return null;
    const accessToken = data.accessToken;
    if (!accessToken) return null;

    console.log(`[IG資料抓取] 用戶 ${userId} 開始抓取...`);

    try {
      if (providerId === "instagram") {
        // 1. 取得基礎帳號資訊
        const meRes = await axios.get(
          "https://graph.instagram.com/v21.0/me",
          {
            params: {
              fields:
                "id,username,account_type,media_count,followers_count,biography,profile_picture_url",
              access_token: accessToken,
            },
          }
        );

        // 優先使用 API 回傳的字串 ID
        const igUserId = meRes.data.id;
        console.log(`[ID檢查] 使用的正確ID: ${igUserId}`);

        const INSIGHTS_URL = `https://graph.instagram.com/v21.0/${igUserId}/insights`;

        // 2. 定義候選指標
        const CANDIDATE_METRICS = [
          "reach",
          "profile_views",
          "total_interactions",
          "accounts_engaged",
          "content_views",
          "likes",
          "comments",
          "shares",
          "saves",
          "website_clicks",
        ];

        const dayMs = 24 * 60 * 60 * 1000;
        const today0 = new Date();
        today0.setHours(0, 0, 0, 0);
        const daysAgo7 = new Date(today0.getTime() - 7 * dayMs);

        const sinceTimestamp = Math.floor(daysAgo7.getTime() / 1000);
        const untilTimestamp = Math.floor(today0.getTime() / 1000);

        let rawDataMap = {};

        const fetchPromises = CANDIDATE_METRICS.map(async (metric) => {
          try {
            const res = await axios.get(INSIGHTS_URL, {
              params: {
                metric: metric,
                period: "day",
                since: sinceTimestamp,
                until: untilTimestamp,
                access_token: accessToken,
              },
            });
            const values = res.data?.data?.[0]?.values || [];
            const totalSum = values.reduce(
              (acc, curr) => acc + (curr.value || 0),
              0
            );
            const latestVal =
              values.length > 0 ? values[values.length - 1].value : 0;

            rawDataMap[metric] = {
              sum_7_days: totalSum,
              latest_day: latestVal,
            };
          } catch (err) {
            rawDataMap[metric] = { error: "Unsupported" };
          }
        });

        await Promise.allSettled(fetchPromises);

        // 3. 處理受眾（城市、國家、性別年齡）
        let audienceData = {
          city: {},
          genderAge: {},
          country: {},
          _available: true,
        };
        try {
          const demoRequests = [
            { key: "city", breakdown: "city" },
            { key: "country", breakdown: "country" },
            { key: "genderAge", breakdown: "gender,age" },
          ];
          await Promise.all(
            demoRequests.map(async (req) => {
              try {
                const res = await axios.get(INSIGHTS_URL, {
                  params: {
                    metric: "follower_demographics",
                    period: "lifetime",
                    breakdown: req.breakdown,
                    access_token: accessToken,
                  },
                });
                const dataPoints =
                  res.data?.data?.[0]?.total_value?.breakdowns?.[0]?.results ||
                  [];
                audienceData[req.key] = dataPoints.reduce((acc, curr) => {
                  audienceData._available = true;
                  const keyName = curr.dimension_values.join(".");
                  acc[keyName] = curr.value;
                  return acc;
                }, {});
              } catch (err) {}
            })
          );
        } catch (e) {
          audienceData._available = false;
        }

        // 4. 計算互動率（Media）
        let calculatedStats = { er: 0, avgLikes: 0 };
        try {
          const mediaRes = await axios.get(
            "https://graph.instagram.com/v21.0/me/media",
            {
              params: {
                fields: "like_count,comments_count",
                limit: 20,
                access_token: accessToken,
              },
            }
          );
          const posts = mediaRes.data.data || [];
          if (posts.length > 0) {
            let tLikes = 0,
              tComms = 0;
            posts.forEach((p) => {
              tLikes += p.like_count || 0;
              tComms += p.comments_count || 0;
            });
            calculatedStats.avgLikes = Math.round(tLikes / posts.length);
            calculatedStats.er =
              (tLikes + tComms) /
              posts.length /
              (meRes.data.followers_count || 1);
          }
        } catch (e) {}

        // 5. 寫入 Firestore
        const finalBrowsing =
          rawDataMap["content_views"]?.sum_7_days ||
          rawDataMap["reach"]?.sum_7_days ||
          0;

        const finalData = {
          id: meRes.data.id,
          username: meRes.data.username,
          followers: meRes.data.followers_count || 0,
          mediaCount: meRes.data.media_count || 0,
          avatar: meRes.data.profile_picture_url || "",

          insights: {
            browsing_count_week: finalBrowsing,
            profile_views_week:
              rawDataMap["profile_views"]?.sum_7_days || 0,
            reach_day: rawDataMap["reach"]?.latest_day || 0,
            total_interactions_day:
              rawDataMap["total_interactions"]?.latest_day || 0,
          },

          raw_debug_data: rawDataMap,
          audience: audienceData,
          advanced: {
            engagement_rate: calculatedStats.er,
            avg_likes: calculatedStats.avgLikes,
          },
          lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        };

        await admin
          .firestore()
          .collection("users")
          .doc(userId)
          .set(
            {
              social_stats: {
                current: {
                  totalFans: finalData.followers,
                  avgEr: finalData.advanced.engagement_rate,
                  ig: { connected: true, ...finalData },
                },
              },
            },
            { merge: true }
          );

        return { success: true };
      }
    } catch (error) {
      console.error("Critical Error:", error);
      return null;
    }
  }
);

module.exports = { fetchInstagramStats };
