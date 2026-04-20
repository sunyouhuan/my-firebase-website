# Firestore Data Dictionary

## Scope
- Project root: my-firebase-website
- Sources analyzed:
  - functions/index.js
  - public/index.html (script type=module)

## Legend
- Type:
  - string, number, boolean, object, array, timestamp
- Write style:
  - set: set/setDoc
  - add: addDoc
  - update: updateDoc
  - read: getDoc/getDocs/onSnapshot/query

## Top-Level Collections

### 1) users

#### Path: users/{uid}
- Purpose:
  - User profile aggregate root.
  - Stores merged social stats from Cloud Functions after IG token change.
- Operations:
  - update/set (merge) from Cloud Functions.
  - read via onSnapshot in frontend.
- Main payload:
  - social_stats.current.totalFans: number
  - social_stats.current.avgEr: number
  - social_stats.current.ig: object
    - connected: boolean
    - id: string
    - username: string
    - followers: number
    - mediaCount: number
    - avatar: string
    - insights: object
      - browsing_count_week: number
      - profile_views_week: number
      - reach_day: number
      - total_interactions_day: number
    - raw_debug_data: object
    - audience: object
    - advanced: object
      - engagement_rate: number
      - avg_likes: number
    - lastUpdated: timestamp

#### Path: users/{uid}/account/profile
- Purpose:
  - Base account profile created right after signup.
- Operations:
  - set (merge)
- Fields:
  - uid: string
  - email: string
  - createdAt: timestamp
  - tutorialBriefAssigned: boolean
  - tutorialBriefId: string

#### Path: users/{uid}/tokens/{providerId}
- Purpose:
  - OAuth/provider token storage.
  - Cloud Function trigger source for social sync.
- Operations:
  - set
  - trigger: onDocumentWritten(users/{userId}/tokens/{providerId})
- Known document ids:
  - instagram
- Common fields:
  - accessToken: string
  - igUserId: string
  - provider: string
  - updatedAt: timestamp

#### Path: users/{uid}/messages/{messageId}
- Purpose:
  - AI chat prompt/response stream documents.
- Operations:
  - add
  - read query + onSnapshot
- Fields written by client:
  - prompt: string
  - createTime: timestamp
  - createTimeMs: number
- Fields expected from extension/backend:
  - response: string
  - status: string
- Query pattern:
  - orderBy(createTimeMs, asc)
  - limit(100)

#### Path: users/{uid}/transfers/{transferId}
- Purpose:
  - Merchant transfer proof submissions.
- Operations:
  - set (doc(collection(...)))
- Fields:
  - amount: number
  - proofImageUrl: string
  - status: string (pending)
  - createdAt: timestamp
  - userId: string
  - userEmail: string

#### Path: users/{uid}/finance/balance
- Purpose:
  - Merchant account balance document.
- Operations:
  - read via onSnapshot
- Fields:
  - currentBalance: number

#### Path: users/{uid}/finance/influencer_balance
- Purpose:
  - Influencer withdrawable balance document.
- Operations:
  - read via onSnapshot
- Fields:
  - amount: number

#### Path: users/{uid}/withdrawals/{withdrawalId}
- Purpose:
  - Influencer withdrawal requests.
- Operations:
  - add
- Fields:
  - userId: string
  - userEmail: string
  - role: string (influencer)
  - amount: number
  - bankCode: string
  - bankAccount: string
  - status: string (pending/approved/rejected)
  - createdAt: timestamp

#### Path: users/{uid}/influencer/profile
- Purpose:
  - Influencer profile for settings and dashboard cards.
- Operations:
  - set (merge)
  - read via onSnapshot
- Fields:
  - name: string
  - contactEmail: string
  - bio: string
  - avatarUrl: string
  - socials: object
    - instagram: string
    - youtube: string
    - tiktok: string
  - updatedAt: timestamp

#### Path: users/{uid}/company/profile
- Purpose:
  - Merchant company profile.
- Operations:
  - get + set (merge)
  - read via onSnapshot
- Fields:
  - name: string
  - regNo: string
  - phone: string
  - address: string
  - website: string
  - logoUrl: string
  - description: string
  - createdAt: timestamp (first write)
  - updatedAt: timestamp

#### Path: users/{uid}/support_messages/{messageId}
- Purpose:
  - Support chat timeline per user.
- Operations:
  - add
  - read query + onSnapshot
- Fields:
  - sender: string (merchant/system)
  - text: string
  - media: array<object>
    - url: string
    - type: string (image/video)
    - name: string
  - createdAt: timestamp
  - timestampMs: number
- Query pattern:
  - orderBy(timestampMs, asc)

### 2) briefs

#### Path: briefs/{briefId}
- Purpose:
  - Campaign master document.
- Operations:
  - add
  - get/read
  - update (soft delete, tutorial audience updates)
  - query + onSnapshot
- Fields commonly written:
  - productName: string
  - categories: array<string>
  - platforms: array<string>
  - productDesc: string
  - requirementDesc: string
  - schedule: object
    - publishStart: string
    - publishEnd: string
    - closingDate: string
    - createdAtText: string
  - impressions: number
  - expectedClicks: number
  - budget: number
  - influencerCount: number
  - influencerCountRange: object
    - min: number
    - max: number
  - followerRange: string
  - logistics: object
    - provideProduct: boolean
    - quantity: number
  - imageUrls: array<string>
  - status: string
  - isDeleted: boolean
  - merchantId: string
  - merchantEmail: string
  - createdAt: timestamp
  - updatedAt: timestamp
  - targetAudience: array<string>
#### test
#### Path: briefs/{briefId}/report/summary
- Purpose:
  - Summary metrics used by merchant report page.
- Operations:
  - set
  - get
- Fields:
  - emv: number
  - roi: number
  - growth_vs_last: number
  - spend: number
  - reach: number
  - fake_filtered_rate: number
  - cpe: number
  - industry_cpe: number
  - funnel_view: number
  - funnel_click: number
  - funnel_convert: number
  - trend_labels: array<string>
  - trend_values: array<number>
  - ai_insights: array<string>
  - next_step_strategy: string
  - updatedAt: timestamp

#### Path: briefs/{briefId}/report/{reportDocId}
- Purpose:
  - Generic report folder documents for raw report viewing.
- Operations:
  - collection read (getDocs)
- Field shape:
  - dynamic, document-dependent

### 3) collaborations

#### Path: collaborations/{collabId}
- Purpose:
  - Collaboration lifecycle between merchant and influencer.
- Operations:
  - add
  - get/read
  - update
  - query + onSnapshot
- Fields commonly written:
  - briefId: string
  - merchantId: string
  - influencerId: string
  - influencerEmail: string
  - status: string
    - accepted
    - reviewing
    - submitting
    - changes_requested
    - approved
    - rejected
    - completed
  - changeRequestCount: number
  - merchantMessage: string
  - marketingLink: string
  - marketingNote: string
  - autoApproved: boolean
  - contentData: array<object> or object
    - url: string
    - type: string (image/video)
    - name: string
  - history: array<object>
    - role: string (merchant/influencer)
    - action: string
    - text: string
    - files: array<object>
    - time: date or timestamp
  - finalResults: array<object>
  - createdAt: timestamp
  - updatedAt: timestamp

## Query Patterns And Index Hints

### briefs queries
- where(merchantId == uid) + where(isDeleted == false) + orderBy(createdAt desc)
- where(status == pending_match) + where(isDeleted == false) + where(targetAudience array-contains uid)
- where(merchantId == uid) + where(isDeleted == false)

Likely composite indexes needed:
- briefs: merchantId ASC, isDeleted ASC, createdAt DESC
- briefs: status ASC, isDeleted ASC, targetAudience ARRAY_CONTAINS

### collaborations queries
- where(influencerId == uid)
- where(briefId == briefId)
- where(merchantId == uid)
- where(briefId == briefId) + where(influencerId == uid)

Likely composite indexes needed:
- collaborations: briefId ASC, influencerId ASC

### support/messages queries
- users/{uid}/messages: orderBy(createTimeMs asc) + limit(100)
- users/{uid}/support_messages: orderBy(timestampMs asc)

Single-field index notes:
- createTimeMs and timestampMs should stay indexed for ordering.

## Cloud Function Trigger Map
- Trigger:
  - onDocumentWritten(users/{userId}/tokens/{providerId})
- Behavior:
  - For providerId instagram/facebook with accessToken, fetch IG data and write merged social stats into users/{userId}.

## Notes
- Some fields in collaboration history use JavaScript Date in client writes, while other timestamp fields use serverTimestamp. Standardizing to server timestamp improves consistency.
- A commented reference exists for possible future path:
  - briefs/{briefId}/results/{influencerId}
