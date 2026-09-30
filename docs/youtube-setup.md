# YouTube Setup Guide for MetaDash

[Türkçe](tr/youtube-setup.md)

MetaDash reads your **own** YouTube channels through Google's official APIs: the **YouTube Data API v3** (channel,
videos, comments) and the **YouTube Analytics API** (views, watch time, average view duration, subscribers gained and
lost, likes, comments, shares, viewer demographics). MetaDash has no server and no shared Google app: you create your
own OAuth client in Google Cloud (free) and MetaDash signs in with it on this computer.

Google's console changes often; menu names may differ slightly. Expect about 15 minutes.

**Contents**

1. [Create a Google Cloud project and enable the APIs](#1-create-a-google-cloud-project-and-enable-the-apis)
2. [Configure the OAuth consent screen](#2-configure-the-oauth-consent-screen)
3. [Create an OAuth client of type "Desktop app"](#3-create-an-oauth-client-of-type-desktop-app)
4. [Connect channels in MetaDash](#4-connect-channels-in-metadash)
5. [Replying to comments (optional)](#5-replying-to-comments-optional)
6. [Quota](#6-quota)
7. [What MetaDash collects, and the limits](#7-what-metadash-collects-and-the-limits)
8. [Privacy, disconnecting and deleting data](#8-privacy-disconnecting-and-deleting-data)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. Create a Google Cloud project and enable the APIs

1. Open [console.cloud.google.com](https://console.cloud.google.com/) and sign in with any Google account (it does not
   have to own the channels).
2. Project picker (top bar) → **New project** → name it e.g. `MetaDash` → **Create**, then select it.
3. **APIs & Services → Library**: search for and **Enable** both
   - **YouTube Data API v3**
   - **YouTube Analytics API**

## 2. Configure the OAuth consent screen

1. **APIs & Services → OAuth consent screen** (newer consoles: **Google Auth Platform → Branding / Audience**).
2. User type **External** (unless every channel belongs to your Google Workspace organisation — then **Internal**).
3. App name `MetaDash (yours)`, your e-mail as support and developer contact. No logo or domain is needed.
4. **Scopes / Data access**: you may add these, MetaDash requests them anyway:
   - `.../auth/youtube.readonly` — channel, videos and comments (read)
   - `.../auth/yt-analytics.readonly` — YouTube Analytics reports
   - `.../auth/youtube.force-ssl` — only if you want to reply to / moderate comments from MetaDash
5. **Publishing status — important:**
   - While the app is in **Testing**, only the Google accounts listed under **Test users** can sign in, and Google
     issues refresh tokens that **expire after 7 days**. MetaDash would ask you to reconnect every week.
   - Click **Publish app** (status **In production**). Because the app is not verified, Google shows an
     "unverified app" warning on the consent screen; choose **Advanced → Go to MetaDash (unsafe)**. That is expected for
     your own private client. Unverified apps are limited to 100 users, which is plenty for your own channels.
   - If you prefer to stay in Testing, add every channel owner's Google account as a **Test user** and expect weekly
     reconnects.

## 3. Create an OAuth client of type "Desktop app"

1. **APIs & Services → Credentials → Create credentials → OAuth client ID** (or **Google Auth Platform → Clients →
   Create client**).
2. Application type: **Desktop app**. Name: `MetaDash`. **Create**.
3. Copy the **Client ID** (`…apps.googleusercontent.com`) and the **Client secret** (`GOCSPX-…`).
   A desktop client's secret is not truly secret (Google says so), but MetaDash still stores it encrypted.
4. No redirect URI has to be registered: desktop clients may redirect to any `http://127.0.0.1:<port>` address, which
   is what MetaDash uses (a one-shot local listener, with PKCE).

## 4. Connect channels in MetaDash

1. **Settings → Connections → YouTube → Google OAuth client**: paste the Client ID and secret → **Save**.
2. Click **Connect channel**. Your browser opens Google's consent screen:
   - pick the Google account, then the **channel** (brand accounts appear in the channel picker);
   - allow the requested access. The browser then shows "You can close this tab".
3. The channel appears in the list and is tracked. Repeat **Connect channel** for each further channel; every channel
   gets its own token, so one expired channel never blocks the others.
4. Run a sync. The first sync reads up to a year of daily Analytics data and your uploads.

Content-owner (CMS / MCN) reports are not supported.

## 5. Replying to comments (optional)

Reading comments only needs `youtube.readonly`. To reply from MetaDash's inbox (or hide comments), click
**Enable replying** next to the channel. MetaDash asks Google again, this time including `youtube.force-ssl`, for that
channel only. Replies are never sent automatically — you always confirm each one.

## 6. Quota

Each Google Cloud project gets **10,000 units per day** of YouTube Data API quota, reset at **midnight Pacific
Time**. List calls (channel, uploads, videos, comment pages) cost 1 unit; posting a reply or changing a comment's
moderation status costs 50. MetaDash never uses `search.list`.

A sync of a channel costs roughly `1 + 2 × ⌈videos ÷ 50⌉` units plus one per video whose comments are polled — a
channel with 300 videos needs about 13 units. MetaDash keeps a ledger per OAuth client (shown in Settings):

- reads stop at 90 % of the daily limit, so at least 500 units stay free for replies;
- if Google reports `quotaExceeded`, YouTube jobs stop for the day with a notice; other platforms keep syncing.

The YouTube Analytics API has its own separate quota and is not counted.

If you need more, request a quota increase in Google Cloud (YouTube API Services audit) — for one team's own channels
the default is normally enough.

## 7. What MetaDash collects, and the limits

| Data | Source | Notes |
|---|---|---|
| Subscribers, video count | `channels.list` | Google rounds subscriber counts down to three significant figures; hidden counts stay empty. Net subscriber change comes from Analytics (exact). |
| Videos | uploads playlist + `videos.list` | Title + description as caption, duration, thumbnail, live/Short/video type. |
| Per video | `videos.list` statistics + Analytics | Views, likes, comments (real time), shares, watch time, average view duration and percentage. |
| Per day | Analytics `dimensions=day` | Views, watch time, avg. view duration, likes, comments, shares, subscribers gained/lost. |
| Demographics (weekly) | Analytics | Viewer age × gender (percent) and views by country (last 28 days). Small channels may get none. |
| Comments | `commentThreads.list` | For the unified inbox; owner replies detected by channel id. |

- **Delay:** YouTube Analytics data arrives 2–3 days late and is revised; MetaDash re-reads the last 7 days on every
  sync. Recent days look low until Google fills them in.
- **Shorts:** the Data API has no "is Short" flag. MetaDash asks Analytics for each video's content type (Shorts /
  video / live). When Analytics has no data for a video yet, videos of up to 3 minutes are counted as Shorts.
- Reach, saves and stories do not exist on YouTube; those tiles are hidden.

## 8. Privacy, disconnecting and deleting data

- Everything is stored only on this computer, in MetaDash's database. Tokens and the client secret are encrypted.
- MetaDash's use of YouTube data follows the [YouTube API Services Terms of Service](https://developers.google.com/youtube/terms/api-services-terms-of-service)
  and [Google Privacy Policy](https://policies.google.com/privacy). Data is only shown to you and in reports you export.
- **Disconnect** (Settings → Connections → YouTube) revokes MetaDash's access at Google and, with
  "Also delete this channel's data" (on by default), deletes the channel, its videos, metrics, comments and
  demographics from MetaDash. Turn the switch off to keep history (the channel is only untracked).
- Google's API policies require stored API data to be refreshed or deleted within 30 days. If a channel has not
  synced for 30 days, MetaDash shows a warning: sync it again or disconnect and delete its data.
- You can also remove MetaDash's access yourself at
  [myaccount.google.com/permissions](https://myaccount.google.com/permissions) (Third-party apps & services).

## 9. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| "Access blocked: app has not completed verification" / "access_denied" | The consent screen is in Testing and your Google account is not a test user — add it, or publish the app (section 2). |
| Reconnect needed every 7 days | The consent screen is still in **Testing**. Publish it (section 2) and reconnect once. |
| "invalid_client" | Client ID/secret mistyped, or the client is not of type **Desktop app**. Create a Desktop client and save it again. |
| "This Google account has no YouTube channel" | Choose the channel (or brand account) on the consent screen, not only the Google account. |
| "Sign-in timed out" | The browser did not come back within 5 minutes. Click **Connect channel** again. |
| No demographics | Google withholds demographics for channels with little traffic. |
| "YouTube API quota for today is used up" | Wait until midnight Pacific Time, or reduce the number of channels per OAuth client (each Cloud project has its own 10,000 units). |
| Channel shows "Sign-in expired or revoked" | Access was revoked at Google, the password changed, or the token was unused for 6 months. Click **Reconnect**. |
| Watch-time numbers differ from YouTube Studio for the last days | Analytics delay (2–3 days); they catch up automatically. |
