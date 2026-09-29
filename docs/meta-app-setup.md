# Meta App Setup Guide for MetaDash

[Türkçe](tr/meta-app-setup.md)

This guide walks you through creating the Meta (Facebook) app that MetaDash needs to read Instagram and ads data, and running it **permanently in Development mode**. No App Review, Business Verification or switch to Live mode is required at any point, because the app only accesses accounts that you (and people with a role on the app) manage.

Meta's interface changes often; menu names may differ slightly from what is shown here. Expect about 15 minutes if your accounts are already prepared.

**Contents**

0. [Before you start](#0-before-you-start)
1. [Prepare your Instagram accounts](#1-prepare-your-instagram-accounts)
2. [Create the Meta app](#2-create-the-meta-app)
3. [Add products and permissions](#3-add-products-and-permissions)
4. [Marketing API access level](#4-marketing-api-access-level-for-ads-data)
5. [Give teammates a role](#5-give-teammates-a-role)
6. [Get an access token (Graph API Explorer)](#6-get-an-access-token-graph-api-explorer)
7. [In MetaDash](#7-in-metadash)
8. [Troubleshooting](#8-troubleshooting)
9. [FAQ](#9-faq)
10. [Useful links](#10-useful-links)

---

## 0. Before you start

| Requirement | How to check |
| --- | --- |
| You have a personal Facebook account with **two-factor authentication (2FA)** enabled | facebook.com → Settings & privacy → Settings → Accounts Center → Password and security → Two-factor authentication. Meta requires 2FA for developer accounts; without it you get stuck on the app creation screen. |
| Every Instagram account is **Professional** (Business or Creator) | Instagram app → Profile → ☰ → Settings and privacy → Account type and tools. If you see "Switch to professional account", it is still a personal account. |
| Every Instagram account is **linked to a Facebook Page** | See section 1.2. Accounts without a linked Page are shown greyed out in MetaDash. |
| Your Facebook user is an **admin** of those Pages (or has full control in Business Manager) | Page → Settings → Page access. If the Page belongs to someone else, they must add you. |
| For ads data: you have **at least Analyst** access to the ad accounts | business.facebook.com → Settings → Accounts → Ad accounts → People. |

> If teammates will also generate tokens, each of them needs a **role** on the Meta app (section 5). People without a role cannot log in to an app in Development mode.

---

## 1. Prepare your Instagram accounts

### 1.1 Switch to a professional account

1. Instagram app → Profile → ☰ → **Settings and privacy** → **Account type and tools** → **Switch to professional account**.
2. Choose **Business** or **Creator**; both work. Pick a category and continue.

### 1.2 Link to a Facebook Page (the most important step)

MetaDash finds accounts through the `Page → instagram_business_account` connection (and, with `business_management`, through Business Manager). Without a linked Page, insights are not available.

**Option A – from Instagram:** Profile → **Edit profile** → **Page** (or Settings → Business tools and controls → **Connected Facebook Page**) → choose an existing Page or create a new one.

**Option B – from the Facebook Page:** facebook.com → your Page → **Settings** → **Linked accounts** → **Instagram** → **Connect account** → log in to Instagram.

**Option C – from Business Suite (best for many accounts):** business.facebook.com → **Settings** → **Accounts** → **Instagram accounts** → **Add** → log in to Instagram → choose which Page and ad accounts it is associated with.

To verify: Page → Settings → Linked accounts should show the Instagram username.

### 1.3 Permissions on the Page

Page → **Settings** → **Page access** → your name must be listed under **People with Facebook access** with **Full control**. For Pages in Business Manager: business.facebook.com → Settings → Accounts → Pages → select the Page → People → add yourself with **Full control**.

---

## 2. Create the Meta app

1. Go to **https://developers.facebook.com/** and log in with your Facebook account. If this is your first time, complete "Register as a developer" (country, phone verification, terms).
2. Top right: **My Apps** → **Create app**.
3. If you see **"What do you want your app to do?"** (use case selection), choose **Other** at the bottom of the list and click **Next**.
   - There are ready-made "Instagram" use cases here too (e.g. "Instagram API with Instagram Login"). **Do not choose them.** MetaDash uses the Facebook Login flow with Page-linked accounts, and "Other → Business" is the most flexible route.
4. On **App type**, choose **Business** → Next.
5. **Details** screen:
   - **App name**: e.g. `Team Analytics` (it must not contain "Facebook", "Instagram" or "Meta").
   - **App contact email**: your email.
   - **Business portfolio**: if your Pages are in a Business Manager, select it; otherwise leave it empty (you can connect it later).
   - Click **Create app** and confirm your password.
6. The App Dashboard opens. Next to the app name (top left) you will see a **Development** toggle. **Never switch it to Live.**

### 2.1 App ID and App Secret

1. Left menu → **App settings** → **Basic**.
2. **App ID**: a 15–16 digit number. Copy it.
3. **App Secret** → **Show** → enter your Facebook password → copy the 32-character value.
4. Paste both values into the **Meta app** step of the MetaDash Setup wizard. MetaDash stores the secret encrypted on your computer; do not share it with anyone.
5. No other field on this page is required. Privacy policy URL, app domains, icon etc. are only needed for Live mode.

---

## 3. Add products and permissions

In Development mode, permissions do not require App Review, but they must be **added** to the app. Otherwise you cannot select them in Graph API Explorer, or you get an "Invalid Scopes" error.

### 3.1 Products

In the left menu, **Add product** (or the product cards in the middle of the dashboard):

1. **Facebook Login for Business** → **Set up**. You do not need to fill in anything (Valid OAuth Redirect URIs are only needed for logging in on your own website; Graph API Explorer uses its own redirect).
2. **Instagram** (on some dashboards "Instagram Graph API" or "Instagram API with Facebook Login") → **Set up**.
3. **Marketing API** → **Set up**. Skip this if you do not need ads data.

You may see yellow warnings such as "Business verification required". They apply to **Advanced Access / Live** mode. In Development mode, **Standard Access** is enough for your own assets; ignore these warnings.

### 3.2 Add permissions to the use case (newer dashboards)

If your dashboard has **Use cases** in the left menu:

1. **Use cases** → next to the use case you created (usually "Other" or "Authenticate and request data from users with Facebook Login") click **Customize**.
2. On the **Permissions and features** tab, click **Add** next to each of these permissions:

   | Permission | Needed for |
   | --- | --- |
   | `instagram_basic` | Instagram profile and media (required) |
   | `instagram_manage_insights` | Account, post and story insights (required) |
   | `pages_show_list` | Listing your Pages (required) |
   | `pages_read_engagement` | Reading the Page → Instagram link (required) |
   | `ads_read` | Ads data (required by the Setup wizard; only used if you link ad accounts) |
   | `business_management` | Pages, Instagram and ad accounts owned by a Business Manager (optional, recommended) |
   | `instagram_manage_comments` | Comments and response-rate metrics (optional) |
   | `read_insights` | Facebook Page statistics – views, viewers, follows, post insights (optional; only needed if you track Facebook Pages, section 7.2) |

3. It is enough that each row shows "Standard access: Ready". **Do not click "Request advanced access"** – it leads to App Review, which is not needed.

On older dashboards (no **Use cases** menu): **App Review** → **Permissions and features** → search for each permission; if the "Standard access" column says **Ready**, it can be used. Again, do not click "Request advanced access".

### 3.3 Connect a business portfolio (if you use Business Manager)

App settings → **Basic** → at the bottom, **Business portfolio**: select the Business Manager that contains your Pages and ad accounts. This does **not** require business verification (document upload); it only creates the link, which lets `business_management` see those assets.

---

## 4. Marketing API access level (for ads data)

Left menu → **Marketing API** → **Tools** or **Access level**. New apps start with **Development access**, which is enough to read ad accounts you have access to; MetaDash uses exactly that. You do **not** need to apply for Standard access.

---

## 5. Give teammates a role

With an app in Development mode, only people who have a role on the app can get a token.

1. Left menu → **App roles** → **Roles** → **Add people**.
2. Enter the person's Facebook name or email and choose **Developer** (or **Administrator**).
3. They must accept the invitation from their Facebook notifications or at developers.facebook.com → My Apps → **Invitations**. They cannot get a token until they accept.
4. They also need admin access to the Pages and access to the ad accounts (section 0).

---

## 6. Get an access token (Graph API Explorer)

1. Open **https://developers.facebook.com/tools/explorer/** (the "Graph API Explorer" button in the MetaDash Setup wizard goes there too).
2. In the right panel, select your app under **Meta App**. If it is not listed, you are logged in with a different Facebook account or have not accepted the invitation.
3. Under **User or Page**, keep **User Token** selected. **Do not choose a Page token.**
4. Click the **Permissions** box and add these permissions (MetaDash's "Copy" button gives you the list; the search box accepts a comma-separated list):

   ```
   instagram_basic, instagram_manage_insights, pages_show_list, pages_read_engagement, ads_read, business_management
   ```

   Add `instagram_manage_comments` as well if you want the comments module, and `read_insights` if you want to track Facebook Pages (section 7.2). If a permission does not appear, it was not added to the app in section 3.2.
5. Click **Generate Access Token**. A Facebook login window opens:
   - **"[App] wants to access your information… / Continue as [your name]"** → **Continue**.
   - If asked to **choose a business portfolio**, pick the one containing your Pages.
   - **"Which Pages do you want to use?"** → **Opt in to all current and future Pages** (or tick all of them).
   - **"Which Instagram accounts…?"** → select **all**, the same way.
   - **"Which ad accounts…?"** → select all.
   - On the permissions summary, **leave everything on** and click **Save / Done**.
6. If you see a notice like **"This app is in development mode… / needs to be reviewed before it can go public"**, it is **informational**: in Development mode all permissions already work for the app's admins, developers and testers. Click **Continue / OK**. Do not click any "submit for review" button; the token is still generated.
7. The **Access Token** field in the Explorer is now filled (it starts with `EAA…`). Copy it, paste it into the **Token** step of MetaDash and click **Exchange and verify**. MetaDash converts it to a 60-day long-lived token and shows granted permissions in green and missing ones in red.

### 6.1 Accounts are greyed out, missing, or only partly selectable in the login window

For users with many assets, the Facebook login window initially lists only some of them and expects you to search for the rest; it may also grey out some accounts. Causes and fixes:

| Situation | Cause | Fix |
| --- | --- | --- |
| Instagram account greyed out, "not connected to a Page" | The account is not professional or not linked to a Facebook Page | Sections 1.1 and 1.2 |
| Instagram account greyed out, "you don't have permission / you're not an admin" | You only have a limited task on the linked Page (e.g. content only) | The Page owner must give you **Full control** (section 1.3) |
| Account not listed at all | It belongs to a different business portfolio | Pick the **correct portfolio** in the portfolio step. With several portfolios, repeat for each, or use the "all current and future" option |
| Nothing shown after the first 20–30 accounts | The window shows a shortened list | Tick **"Opt in to all current and future …"** at the top instead of selecting one by one. If the option is missing, search for each account name and tick it |
| I selected some accounts and want to add more later | Permission was already granted once | facebook.com → **Settings & privacy → Settings → Business integrations** → your app → **View and edit** → tick the missing Pages/Instagram/ad accounts and save. Then generate a **new token** in the Explorer, repeat the Token step in MetaDash and click **Discover again** in Account selection |
| Account is in Business Manager but you have no personal Page role | `/me/accounts` does not return it | MetaDash also scans Business Manager Pages and Instagram accounts through `business_management`; make sure the token includes it. If it is still missing, assign that Page/Instagram account to your user in Business Manager → People |
| Account shows a "No Page" badge | The Instagram account was added to Business Manager but is not linked to a Page | Link it to a Page via section 1.2, option C. Insights are unavailable until it is linked |

To check, run these in the Explorer. MetaDash's account selection list is the union of the three:

```
me/accounts?fields=name,instagram_business_account{username}&limit=100
me/businesses?fields=name,owned_pages{name,instagram_business_account{username}},client_pages{name,instagram_business_account{username}}
me/businesses?fields=name,owned_instagram_accounts{username},client_instagram_accounts{username}
```

### 6.2 Quick token test in the Explorer

Type this into the Explorer's query field and click **Submit**:

```
me/accounts?fields=name,instagram_business_account{username,followers_count}&limit=100
```

Each Page should have an `instagram_business_account` field. A Page without it has no Instagram link (section 1.2). If no Pages come back at all, you did not select Pages in the login window: run **Generate Access Token** again and select all of them (if needed, remove the app under facebook.com → Settings → **Business integrations** and grant access again).

For ad accounts:

```
me/adaccounts?fields=name,account_status,currency
```

---

## 7. In MetaDash

1. Setup wizard: **Welcome → Meta app** (App ID + Secret) **→ Token** (paste, exchange) **→ Account selection** (discovered Instagram accounts; set client names and tags) **→ Ad accounts** (optionally link each to an Instagram account) **→ First sync**.
2. The first sync can take a few minutes for dozens of accounts; progress is shown in the top bar.
3. Afterwards, refresh with the **Update** button in the top bar or turn on automatic daily updates in Settings.

### 7.1 Renewing the token (about every 60 days)

The long-lived token is valid for 60 days. MetaDash shows the remaining days under Settings → Connection and displays a red warning at the top when Meta returns error 190. To renew: Settings → Connection → **Renew token** (takes you to the Token step) → repeat section 6. Existing data is kept.

### 7.2 Tracking Facebook Pages

MetaDash can also track the Facebook Pages themselves (views, viewers, follows/unfollows, post engagements, Page profile views and per-post views, viewers, reactions, comments, shares and clicks). It uses the same Meta app and token as Instagram; no extra app is needed.

1. **Permission:** add `read_insights` to the app (section 3.2) and include it in the token (section 6), then exchange the token again in MetaDash. `pages_show_list` and `pages_read_engagement` are already required. Without `read_insights`, Pages can be listed but their statistics are refused.
2. **Your role on each Page must include insights access (the `ANALYZE` task).** Full control, or any Page role/task set that includes "View insights" / "Insights", works. Check it in the Explorer:

   ```
   me/accounts?fields=name,tasks&limit=100
   ```

   `tasks` must contain `ANALYZE`. For Pages managed in Business Manager: business.facebook.com → Settings → Accounts → Pages → the Page → People → give yourself a task set that includes insights. Pages without `ANALYZE` are shown with a warning in MetaDash.
3. **Choose the Pages:** Pages are **not tracked by default**. In MetaDash open the Facebook Pages list (Setup → account selection, or Settings → Connections), tick the Pages you want and save. A Page linked to a tracked Instagram account inherits that account's client name and tags.
4. The next sync (Update button or the daily automatic update) fetches them. For each Page, MetaDash asks Meta for a **Page access token** at the start of every sync, using your user token; you never paste Page tokens yourself.

Notes:
- Meta renamed most Page metrics in 2025–2026 ("impressions" became **views**, "reach" became **viewers**, "fans" became **followers**). MetaDash tries the current metric names first and falls back automatically; metrics that Meta no longer supports are listed under Settings and can be re-enabled there later.
- Page insights can be requested for at most 90 days back, so the first sync fills at most the last 90 days.

### 7.3 Publishing permissions (Planner, optional)

Publishing from the Planner (v1.4) needs extra permissions. Analytics keeps working without them; add them only if you publish from MetaDash.

| Platform | Permission | Needed for |
|---|---|---|
| Instagram | `instagram_content_publish` | posts, carousels, reels, stories |
| Instagram | `instagram_manage_comments` | the first comment (already optional for comment sync) |
| Facebook Pages | `pages_manage_posts` | posts, photos, albums, videos, reels, scheduling on Facebook |
| Facebook Pages | `pages_manage_engagement` | the first comment |

1. Add the permissions to the app's use case (section 3.2). While the app is in development mode they work for everyone with a role on the app (section 5); App Review is only needed for people without a role.
2. Tick them in Graph API Explorer when you generate the token (section 6) and exchange the token again in MetaDash (Settings → Connection → **Renew token**). A token only carries the permissions that were ticked when it was created, so existing users must renew it.
3. **Facebook Pages** also need the `CREATE_CONTENT` task on each Page (Explorer: `me/accounts?fields=name,tasks` — `tasks` must contain `CREATE_CONTENT`).
4. Settings → Publishing shows per-platform readiness and what is missing. Media hosting for Instagram and Threads and the full walkthrough are in [publishing-setup.md](publishing-setup.md).

---

## 8. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| My app is not listed in the Explorer | Logged in with another Facebook account, or invitation not accepted | Log in with the right account; check My Apps → Invitations |
| `instagram_manage_insights` does not appear in the Permissions box | The permission was not added to the app | Section 3.2 – Use case → Customize → **Add** the permission |
| "Invalid Scopes: instagram_manage_insights" | Same cause, or the Instagram product was not added | Sections 3.1 and 3.2 |
| A screen saying the app cannot use these permissions without review | Informational (Development mode) | Click Continue/Next; do not submit for review |
| Page/Instagram list in the login window is empty | Account not professional, not linked to a Page, or you are not a Page admin | Sections 0 and 1 |
| `me/accounts` returns the Page but no `instagram_business_account` | Page–Instagram link missing | Section 1.2 (option B or C) |
| MetaDash: "(#10) Application does not have permission" / code 10 or 200 | Permission not included in the token | Add the permission in the Explorer, generate a **new** token and exchange it again in MetaDash |
| MetaDash: code 190 "Error validating access token" | Token expired, password changed or app access removed | Section 7.1 |
| "(#100) Tried accessing nonexisting field (instagram_business_account)" | `pages_read_engagement` / `instagram_basic` missing | Add the permissions and generate a new token |
| "(#100) Unsupported get request" (media/insights) | Account not professional, or newly linked (insights appear after a few hours) | Check the account type; try again in a few hours |
| `me/adaccounts` is empty | No access to the ad account, or ad accounts not selected in the login window | Grant access in Business Manager; regenerate the token |
| "(#4) Application request limit reached" / codes 17, 32, 613 | Temporary rate limit | MetaDash slows down and retries automatically; try again in an hour |
| "2500 An active access token must be used" | Token was truncated when pasting | Copy the whole token from the Explorer |
| Instagram account belongs to another Business Manager | Wrong portfolio selected | Pick the correct portfolio in the login window; if needed connect the app to that portfolio (section 3.3) |
| Stuck on "phone verification / 2FA" while creating the app | Developer account not verified | Enable 2FA in Accounts Center, verify your phone, try again |
| Facebook Page skipped: "could not get an access token for the Page" | You no longer manage the Page, or the Page was not selected in the login window | Check Page access (section 1.3); in facebook.com → Settings → Business integrations add the Page to the app, generate a new token and exchange it again |
| Facebook Page skipped: "role does not include the ANALYZE task" / code 10 on `/insights` | Your Page role has no insights access, or `read_insights` is missing from the token | Section 7.2 steps 1–2 |

When a metric is rejected by Meta (error code 100 for a specific metric), MetaDash drops it from future requests and lists it under Settings, where you can re-enable it later.

---

## 9. FAQ

**Do I need to switch the app to Live mode?**
No. Live mode opens the app to users outside your team and requires review and verification. MetaDash only reads assets of people who have a role on the app.

**I see a "Business verification required" warning.**
It is for Advanced Access. It is not needed for Standard Access to your own assets.

**I have several Business Managers.**
Generate the token with a single Facebook user that has access to all of them, and select the Pages from every portfolio in the login window.

**A client does not want to add me to their Page.**
They can add your business as a **Partner** in their Business Manager and assign content/insights tasks for the Page and Instagram account. You do not have to be an admin, but the account must be visible to you for `instagram_manage_insights` to work.

**Can I connect an Instagram account without a Page (Instagram Login only)?**
Not in this version; MetaDash uses the Page-linked flow.

**Can I use the same Meta app and token on another computer?**
Yes. The Meta app can be used from any number of MetaDash installations; each installation stores its own copy of the token, encrypted with a key tied to that computer. To move all data including secrets, use Settings → Data transfer with a passphrase.

**What if my App Secret leaks?**
App settings → Basic → **Reset** to generate a new secret, enter it in MetaDash and get a new token.

---

## 10. Useful links

- App Dashboard: https://developers.facebook.com/apps/
- Graph API Explorer: https://developers.facebook.com/tools/explorer/
- Access Token Debugger (permissions and expiry): https://developers.facebook.com/tools/debug/accesstoken/
- Business Suite settings (Instagram–Page–ad account links): https://business.facebook.com/settings/
- Permissions reference: https://developers.facebook.com/docs/permissions/
- Instagram API with Facebook Login: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/
- Page Insights metrics reference: https://developers.facebook.com/docs/graph-api/reference/insights
