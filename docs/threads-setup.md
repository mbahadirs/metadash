# Threads Setup Guide for MetaDash

[Türkçe](tr/threads-setup.md)

MetaDash reads your **own** Threads profiles' posts and insights through the official Threads API. Threads has its own
app credentials and its own access token, separate from the Meta (Instagram/Facebook) connection described in
[meta-app-setup.md](meta-app-setup.md). The app can stay in **Development mode**: people with a role on the app
(you and your Threads testers) can connect without App Review.

Meta's interface changes often; menu names may differ slightly. Expect about 10 minutes.

**Contents**

1. [Create the app with the Threads use case](#1-create-the-app-with-the-threads-use-case)
2. [Find the Threads App ID and App Secret](#2-find-the-threads-app-id-and-app-secret)
3. [Add the Threads account as a tester](#3-add-the-threads-account-as-a-tester)
4. [Set a redirect URL](#4-set-a-redirect-url)
5. [Connect in MetaDash (code or token)](#5-connect-in-metadash)
6. [Token lifetime and automatic refresh](#6-token-lifetime-and-automatic-refresh)
7. [What MetaDash collects, and the limits](#7-what-metadash-collects-and-the-limits)
8. [Troubleshooting](#8-troubleshooting)

---

## 1. Create the app with the Threads use case

1. Go to [developers.facebook.com/apps](https://developers.facebook.com/apps) → **Create app**.
2. When asked for a use case, choose **Access the Threads API**. You can also add the Threads use case to an app
   you already have (App Dashboard → **Use cases** → **Add use case**).
3. Open **Use cases** → **Access the Threads API** → **Customize** (or **Permissions**) and make sure these
   permissions are added:
   - `threads_basic` (profile and posts, always required)
   - `threads_manage_insights` (views, likes, replies, reposts, quotes, followers, demographics)

   Optional: `threads_content_publish` and `threads_manage_replies` to publish from the Planner
   ([publishing-setup.md](publishing-setup.md)), and `threads_read_replies` to read replies in the unified inbox
   ([inbox.md](inbox.md)). MetaDash asks for them only when **Also request publishing permission** is on in
   Settings → Connections.

## 2. Find the Threads App ID and App Secret

An app with the Threads use case has **two** app IDs and secrets. MetaDash needs the **Threads** ones:
App Dashboard → **App settings** → **Basic**, in the section labelled **Threads App ID** / **Threads App Secret**
(not the Facebook App ID at the top). Click **Show** to reveal the secret.

MetaDash stores the secret encrypted on this computer. It is never sent anywhere except to Threads when a token is
exchanged or refreshed.

## 3. Add the Threads account as a tester

In Development mode only accounts with a role on the app can connect.

1. App Dashboard → **App roles** → **Roles** → **Add People** → choose **Threads Tester** and enter the Threads
   username.
2. Sign in to that Threads account (app or threads.com) → **Settings** → **Account** → **Website permissions** →
   **Invites** → accept the invite.

## 4. Set a redirect URL

App Dashboard → **Use cases** → **Access the Threads API** → **Settings** → **Redirect Callback URLs**.
The URL must start with `https://` and must match exactly (watch for a trailing `/`). MetaDash suggests
`https://localhost/`: nothing needs to run there, you only copy the code from the browser's address bar.
If Meta rejects `localhost`, use any https address you control. Enter the same URL in MetaDash.

## 5. Connect in MetaDash

Open **Setup → Threads** (or **Settings → Connections → Threads**) and save the Threads App ID and App Secret.
Then use one of these:

**A. Authorization code (recommended)**

1. Click **Open Threads login**. The browser opens `threads.com/oauth/authorize` for your app with the
   `threads_basic` and `threads_manage_insights` permissions.
2. Log in and approve. The browser is redirected to your redirect URL, for example
   `https://localhost/?code=AQB...#_`. The page may fail to load; that is fine.
3. Copy the whole address (or only the code) and paste it into MetaDash. MetaDash removes the trailing `#_`.
   Codes are valid for **1 hour** and can be used **once**.

**B. Access token**

If you already have a Threads user access token (for example from the Graph API Explorer with your Threads app
selected, or the token generator in the Threads use case settings, if your dashboard shows one), paste it instead.

Either way MetaDash exchanges it for a **long-lived token** (60 days), reads your profile (`/me`) and adds the Threads
profile to your tracked accounts. You can untrack it later without disconnecting.

## 6. Token lifetime and automatic refresh

- Long-lived Threads tokens are valid for **60 days**.
- While MetaDash is open it refreshes the token automatically when **more than 24 hours** have passed since the last
  refresh and it expires within **20 days**. Each refresh gives another 60 days.
- Threads only refreshes a token that is at least 24 hours old and has **not yet expired**. A token that was not
  refreshed within 60 days (e.g. MetaDash was not opened for two months) expires for good: connect again (step 5).
- If a refresh fails you get a warning; you can also press **Refresh** in Settings → Connections.
- A Threads token problem never stops the Instagram/Facebook sync: Threads is skipped and the run is marked partial.
- **Disconnect** removes the token and stops tracking the profile; the data already collected is kept.

## 7. What MetaDash collects, and the limits

| Data | Source | Notes |
| --- | --- | --- |
| Profile | `/me` | username, name, picture, biography |
| Followers | `threads_insights` `followers_count` | current total per sync; daily change is derived from these snapshots |
| Posts | `/{user}/threads` | text, image, video, carousel and audio posts. Reposts of other people's posts are skipped |
| Post metrics | `/{post}/insights` | views, likes, replies (shown as comments), reposts, quotes, shares |
| Daily account metrics | `threads_insights` | views (daily series); likes, replies, reposts, quotes and link clicks per day |
| Demographics | `follower_demographics` | age, gender, country, city; weekly; **only for profiles with at least 100 followers** |

Limits:
- Account insights are not available before **13 April 2024** (Meta only guarantees data from 1 June 2024). MetaDash
  never asks for earlier dates.
- Threads has no reach metric; MetaDash uses **views** as the main metric for Threads.
- Threads has its own rate limit (based on your profile's impressions over 24 hours), separate from the Meta Graph
  API. MetaDash syncs Threads one profile at a time and slows down automatically.
- One Threads profile per MetaDash installation in this version.

## 8. Troubleshooting

| Message | What to do |
| --- | --- |
| *The Threads App ID must contain digits only* | You probably copied the Facebook App ID or the app name. Use the **Threads App ID** (step 2). |
| *The Threads authorization code is invalid or has expired* | Codes last 1 hour and work once. Log in again and paste the new code. Check the redirect URL is identical in the dashboard and MetaDash. |
| *The Threads token is invalid* | The token belongs to another app, was revoked, or the account is not a tester (step 3). Create a new one. |
| *A Threads token can only be refreshed when it is at least 24 hours old* | Wait a day; the automatic refresh will handle it. |
| *Your Threads connection has expired* | Connect again (step 5). |
| Demographics stay empty | The profile needs at least 100 followers. |
| "Redirect URI mismatch" in the browser | The URL in the dashboard and in MetaDash must be the same, including `https://` and the trailing `/`. |
