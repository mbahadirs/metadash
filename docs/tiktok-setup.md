# TikTok Setup Guide for MetaDash (experimental)

[Türkçe](tr/tiktok-setup.md)

MetaDash can read your **own** TikTok accounts through TikTok's official **Login Kit** and **Display API**, using a
TikTok developer app that you create. The integration is marked **Experimental**: TikTok gives third-party apps much
less data than Meta or YouTube, and the Display API must be approved for your app before accounts other than your
sandbox test users can connect.

Checked against developers.tiktok.com on 2026-09-30. TikTok's portal changes often; menu names may differ.

**Contents**

1. [What MetaDash can and cannot get](#1-what-metadash-can-and-cannot-get)
2. [Create the developer app](#2-create-the-developer-app)
3. [Register the redirect URI](#3-register-the-redirect-uri)
4. [Sandbox or production](#4-sandbox-or-production)
5. [Connect in MetaDash](#5-connect-in-metadash)
6. [Tokens and privacy](#6-tokens-and-privacy)
7. [Troubleshooting](#7-troubleshooting)

---

## 1. What MetaDash can and cannot get

| Available (Display API) | Scope |
|---|---|
| Profile: display name, avatar, username, bio, verified badge | `user.info.basic`, `user.info.profile` |
| Followers, following, total likes, video count | `user.info.stats` |
| Public videos: caption, date, duration, cover, link, **views, likes, comments, shares** (cumulative) | `video.list` |

**Not available** to third-party Display API apps: per-day analytics, reach, watch time, traffic sources, audience
demographics, reading or replying to comments. (These live in TikTok's separate *API for Business*, which needs a
Business account and a different approval; MetaDash v2.0 does not use it.)

Because there is no daily series, MetaDash **estimates** daily views and new followers from what each sync stores:
- new followers per day = follower count at this sync day − follower count at the previous sync day;
- views per day = the growth of every video's cumulative view count between syncs.

The account page labels these "estimated from syncs". Sync at least once a day (Settings → Sync → daily auto-update, or a scheduled [CLI](cli.md) sync) for accurate
days; a day without a sync shows its growth on the next synced day.

Other limits:
- Cover images are CDN links that expire after about 6 hours; MetaDash refreshes them on every sync.
- Only public videos are returned. Photo posts are not part of the documented video list.
- Rate limit: 600 requests per minute per endpoint. MetaDash asks for 20 videos per call and refreshes post counts
  in groups of 20, so even large accounts need only a handful of calls.

## 2. Create the developer app

1. Sign in at [developers.tiktok.com](https://developers.tiktok.com/) and open **Manage apps** → **Connect an app**
   (or **Create app**). Choose an individual or organisation developer account.
2. Fill in the app details (name, icon, category, description, terms and privacy URLs are required for review).
3. **Platforms**: select **Desktop**. (Add **Web** too only if you want the paste-code fallback, see §3.)
4. **Add products**: **Login Kit** and **Display API**.
5. **Scopes**: make sure these are added: `user.info.basic`, `user.info.profile`, `user.info.stats`, `video.list`.
6. Copy the **Client key** and **Client secret** from the app page.

In MetaDash: **Settings → Connections → TikTok → TikTok developer app**, paste the client key and secret, and
tick *This is a sandbox app* if the key belongs to a sandbox (sandbox keys have their own key and secret). The
secret is encrypted on this computer and never leaves it except in the token requests to TikTok.

## 3. Register the redirect URI

**Recommended — Desktop loopback.** TikTok's desktop Login Kit accepts loopback redirect URIs with any port. In
Login Kit → **Redirect URI** (Desktop), register exactly:

```
http://127.0.0.1:*/callback/
```

MetaDash opens a one-time local listener on a random port, your browser returns there after you approve, and the
connection completes by itself. Nothing is exposed to the network (127.0.0.1 only; the listener closes after one
request or 5 minutes).

**Fallback — paste code.** If the loopback does not work for you (for example a strict firewall or a remote
desktop), add the **Web** platform and register an https callback page, then use *Paste-code sign-in* in MetaDash.
MetaDash ships a static page for this at `docs/oauth/callback.html`; the default address is
`https://mbahadirs.github.io/metadash/oauth/callback.html` (you can host your own copy and enter its address under
*Paste-code callback page*). The page only shows the `code` and `state` from its address so you can copy them —
it has no scripts that send anything anywhere. The code alone is useless: exchanging it needs your client secret
and the PKCE verifier, which never leave your computer, and it expires within minutes.

> The paste-code flow is less tested: TikTok documents PKCE only for desktop/mobile redirects. If TikTok rejects the
> code with a *code verifier* error, use the loopback flow.

## 4. Sandbox or production

- **Sandbox**: no review needed. Add up to **10 target users** (Sandbox → **Target users**) — only these TikTok
  accounts can sign in. Good for trying MetaDash with your own accounts.
- **Production**: submit the app for review with the four scopes. TikTok reviews how the data is used (a short
  screen recording of MetaDash's connection card and account page is usually requested). After approval any
  account you manage can connect.

## 5. Connect in MetaDash

1. **Settings → Connections → TikTok → Connect with browser.** Sign in to the TikTok account you want to add and
   approve the scopes.
2. The browser shows *Signed in*; MetaDash adds the account (`@username`) and tracks it. Run a sync.
3. Repeat for every TikTok account (each account is a separate connection with its own tokens).

Use the **Track** switch to include or exclude an account from syncs, and **Disconnect** to revoke MetaDash's access
at TikTok. When disconnecting you can also delete everything MetaDash stored for that account.

## 6. Tokens and privacy

- Access tokens are valid for **24 hours**; MetaDash refreshes them automatically during syncs.
- The refresh token is valid for **365 days** (TikTok may rotate it; MetaDash always keeps the newest). When it is
  about to expire MetaDash shows a warning; reconnect the account to renew it.
- Tokens are stored encrypted in MetaDash's local database. They are never exported in backups without a passphrase
  and are never sent to the optional publish worker.
- You can also remove MetaDash's access from the TikTok app itself (the app-permissions list under its security
  settings; the exact menu name varies by version).

## 7. Troubleshooting

| Message | Meaning / fix |
|---|---|
| *redirect_uri* error on the TikTok page | The redirect URI is not registered exactly (`http://127.0.0.1:*/callback/` for Desktop, including the trailing slash). |
| *Login expired — reconnect* | The refresh token expired or was revoked (for example you removed the app in TikTok). Connect the account again. |
| *scope_not_authorized* in the sync log | The account did not grant a scope, or the scope is not added to your app. Add it in the portal and reconnect. |
| *rate_limit_exceeded* | More than 600 calls/minute. MetaDash backs off and retries; syncs continue on the next run. |
| Only some accounts can sign in | Your app is in sandbox: add the account as a target user or get the app approved. |
| Daily views look lumpy | Estimated from syncs: days without a sync push their growth to the next synced day. Sync daily. |
