# Publishing setup (Planner)

[Türkçe](tr/publishing-setup.md)

MetaDash can publish the posts you plan in the **Planner** to Instagram, Facebook Pages and Threads. This guide covers the permissions each platform needs, the media host that Instagram and Threads require, the limits MetaDash checks, and what happens when your computer is off.

Publishing is optional. Analytics works without any of this.

- [1. Permissions](#1-permissions)
- [2. Media hosting (Instagram and Threads)](#2-media-hosting-instagram-and-threads)
- [3. What works while the computer is off](#3-what-works-while-the-computer-is-off)
- [4. How publishing runs](#4-how-publishing-runs)
- [5. Limits](#5-limits)
- [6. Troubleshooting](#6-troubleshooting)

---

## 1. Permissions

| Platform | Permission | Needed for |
|---|---|---|
| Instagram | `instagram_content_publish` | posts, carousels, reels, stories |
| Instagram | `instagram_manage_comments` | the first comment |
| Facebook Pages | `pages_manage_posts` | posts, photos, albums, videos, reels, scheduling on Facebook |
| Facebook Pages | `pages_manage_engagement` | the first comment |
| Threads | `threads_content_publish` | posts |
| Threads | `threads_manage_replies` | the first comment (sent as a reply) |

**Instagram and Facebook** use the same Meta token as analytics:

1. Add the permissions to your app's use case ([meta-app-setup.md](meta-app-setup.md), section 3.2).
2. Generate a new token in Graph API Explorer with them ticked (section 6) and exchange it in MetaDash (Settings → Connection → **Renew token**). A token only has the permissions that were ticked when it was created, so you must renew it after adding them.
3. Each Facebook Page also needs the `CREATE_CONTENT` task. Check it in the Explorer with `me/accounts?fields=name,tasks`.

**Threads:** add `threads_content_publish` and `threads_manage_replies` to the Threads use case of your app ([threads-setup.md](threads-setup.md)) and reconnect Threads so that the new authorization includes them. MetaDash only requests the publishing permissions when you connect with publishing enabled, because the Threads login page shows an error if the app does not have them.

Settings → Publishing shows, per platform, whether you can publish and which permissions are missing. The composer shows a blocking error for a missing publishing permission and a warning when only the first-comment permission is missing.

## 2. Media hosting (Instagram and Threads)

Instagram and Threads do not accept file uploads for images: Meta downloads them from a **public URL**. Threads needs a public URL for videos too. (Instagram videos and everything on Facebook are uploaded directly; no host is needed for those.)

MetaDash therefore copies the file to storage you control, gives Meta the link, and deletes the copy after publishing. Choose the host in Settings → Publishing:

| Host | Works for | Notes |
|---|---|---|
| **S3-compatible bucket** (recommended) | images and videos | Cloudflare R2, AWS S3, Backblaze B2, MinIO, Wasabi |
| Facebook Page (experimental) | images only | unofficial; see 2.4 |
| Already hosted | images and videos | you mirror the media folder yourself; see 2.5 |
| None | – | Instagram image posts and Threads media posts are blocked |

The keys are stored encrypted on this computer (like your Meta token). Media goes only from your computer to your bucket, and from your bucket to Meta.

### 2.1 Cloudflare R2 (step by step)

R2 has a free tier and no egress fees, which suits this well.

1. Cloudflare dashboard → **R2** → **Create bucket**, e.g. `metadash-media`. Keep it private.
2. R2 → **Manage R2 API Tokens** → **Create API token** → permission **Object Read & Write**, limited to that bucket. Copy the **Access Key ID** and **Secret Access Key**.
3. Note your **account ID**: the S3 endpoint is `https://<account-id>.r2.cloudflarestorage.com`.
4. MetaDash → Settings → Publishing → Media host **S3-compatible**:
   - Endpoint: `https://<account-id>.r2.cloudflarestorage.com`
   - Region: `auto`
   - Bucket: `metadash-media`
   - Path-style URLs: on
   - Access key ID / Secret access key: from step 2
5. Press **Test**. MetaDash uploads a 1×1 JPEG, downloads it anonymously through the link Meta would get, and deletes it.
6. Add a lifecycle rule as a safety net (below).

By default Meta receives a **presigned link** that expires after `URL lifetime` (default 24 h, maximum 7 days). If you prefer a public bucket or a custom domain (R2 → bucket → Settings → Public access / Custom domain), enter it as **Public base URL** (for example `https://media.example.com`); MetaDash then sends `<public base URL>/<key>` instead. Use this if Meta ever refuses presigned links.

### 2.2 AWS S3

1. Create a bucket (Block Public Access can stay on when you use presigned links).
2. Create an IAM user with a policy that allows `s3:PutObject`, `s3:GetObject` and `s3:DeleteObject` on `arn:aws:s3:::<bucket>/metadash/*`, and create an access key for it.
3. In MetaDash leave **Endpoint** empty, set **Region** to the bucket's region (for example `eu-central-1`), and turn path-style URLs off.

### 2.3 MinIO, Backblaze B2, Wasabi

Use the provider's S3 endpoint and region, for example `https://s3.eu-central-003.backblazeb2.com` for B2 or `https://minio.example.com` for MinIO. Turn **path-style URLs** on for MinIO and for bucket names that contain dots. The endpoint must use `https` (plain `http` is accepted only for `localhost`). Meta must be able to reach the URL from the internet, so a MinIO on your laptop only works behind a public HTTPS address.

### Lifecycle rule (recommended)

MetaDash deletes each copy after the post is published (**Delete after publishing**, on by default). If a post fails or the app is closed at the wrong moment, a copy can remain. Add a rule that deletes objects under the `metadash/` prefix after 2 days:

- R2: bucket → Settings → **Object lifecycle rules** → prefix `metadash/`, delete after 2 days.
- AWS: bucket → Management → **Create lifecycle rule** → prefix `metadash/`, expire current versions after 2 days.

### 2.4 Facebook Page host (experimental)

MetaDash uploads the image as an **unpublished photo** to a Facebook Page you manage, takes the photo's CDN link and gives that to Instagram/Threads. The photo is deleted after publishing. Instagram accounts use their linked Page; for Threads, enter a Page ID in Settings.

This is not an official Meta feature: CDN links are signed and can expire, and it can stop working at any time. It does not work for videos. Use a bucket if you publish regularly.

### 2.5 Already hosted

If you already sync a folder to a web server, point MetaDash at its public base URL. Files must be reachable as `<base URL>/<sha256>.<ext>`, which is the name MetaDash uses in its `planner-media` folder (in the app's data folder). MetaDash checks each file with an anonymous HEAD request before publishing. Instagram images that need conversion (PNG, WebP or wider than 1440 px) cannot be published this way; export them as JPEG up to 1440 px wide.

## 3. What works while the computer is off

| | Computer off or asleep | Computer on, MetaDash running (window can be closed in tray mode) |
|---|---|---|
| Facebook post with **Schedule on Facebook** | ✅ Facebook publishes it | ✅ |
| Instagram, Threads, Facebook without that option | ❌ missed | ✅ |
| Any post set to **Publish via: Worker** ([self-hosted worker](worker.md)) | ✅ the worker publishes it | ✅ |

- **Schedule on Facebook** hands the post to Facebook's own scheduler right away. It needs a time between 10 minutes and 30 days ahead. A first comment on such a post is only added once MetaDash is running and sees that the post is live.
- Everything else is published by MetaDash itself, so the app must be running at the scheduled time. Turn on **tray mode** (Settings → Background mode) so closing the window keeps MetaDash running, and optionally **launch at login**. A closed laptop lid still puts the computer to sleep.
- Instagram videos are prepared up to 30 minutes before the scheduled time and images 5 minutes before, so MetaDash should already be running then.

**Missed posts.** If the computer was asleep more than 15 minutes (**grace period**) past a post's time, MetaDash follows the **missed-post policy** in Settings:

- *Ask* (default): the post is marked missed, and a notification opens the queue, where you choose **Publish now**, **Reschedule** or **Skip**.
- *Publish anyway*: publish if it is at most **Maximum delay** (default 180 minutes) late, otherwise mark it missed.
- *Skip*: mark it missed.

## 4. How publishing runs

- Each account publishes one post at a time, and at most two posts run in parallel.
- Every step is saved before the next network call. If MetaDash quits in the middle of a publish, it checks on the next start whether the post went live instead of sending it again. When it cannot tell, the item fails with **"cannot tell whether the post went live"**: check the account and use **Retry** only if the post is not there.
- Temporary errors (Meta server errors, network problems) are retried after 1, 5, 15, 60 and 180 minutes, then the item fails. Rate limits wait 15 minutes. When the 24-hour publishing limit is reached, MetaDash waits 30 minutes at a time and shows a warning.
- An expired or invalid token pauses publishing for that platform (Instagram and Facebook share the Meta token) and shows a notification. Publishing resumes after you renew the token.
- **Pause publishing** (Settings or tray) stops new steps; a publish that is already running finishes.
- Each step is written to the post's log together with Meta's error code and `fbtrace_id` (quote it to Meta support).

## 5. Limits

MetaDash checks these before scheduling. Values marked **VERIFY** are not confirmed by current Meta documentation (or the documents disagree); MetaDash uses the conservative value. All of them live in `src/main/publishing/limits.js`. Checked against Meta's developer documentation on 2026-09-29. If Meta behaves differently, see [Known limitations](known-limitations.md) and please open an issue.

| | Instagram | Facebook Page | Threads |
|---|---|---|---|
| Caption | 2,200 characters, ≤ 30 hashtags, ≤ 20 mentions (VERIFY) | 63,206 (VERIFY) | 500 characters, ≤ 5 links, 1 topic tag (VERIFY) |
| Images | JPEG (PNG/WebP converted automatically), ≤ 8 MB, ratio 4:5 – 1.91:1, 320–1440 px wide | JPEG/PNG/GIF/BMP/TIFF, ≤ 10 MB (VERIFY) | JPEG/PNG, ≤ 8 MB, ratio ≤ 10:1, 320–1440 px wide |
| Carousel / album | 2–10 items (10 is documented; still flagged VERIFY in code) | 2–10 photos (VERIFY) | 2–20 items |
| Video | Reels MP4/MOV, H.264/HEVC + AAC, 3 s – 15 min, ≤ 300 MB, 23–60 fps, 9:16 recommended | video ≤ 10 GB / 4 h (files over 1 GB are not supported yet); reels 3–90 s, 9:16 | MP4/MOV, ≤ 5 min, ≤ 1 GB, 23–60 fps |
| Stories | image ≤ 8 MB or video 3–60 s, ≤ 100 MB; the caption is ignored | – | – |
| Per 24 hours | 100 posts (a carousel counts as one) | Reels: 30 via the API | 250 posts, 1,000 replies |
| Scheduling on the platform | – | 10 min – 30 days ahead (Meta's references say 30 or 75 days; VERIFY) | – |
| Prepared media expires | 24 h | – | 24 h |

## 6. Troubleshooting

| Message | What to do |
|---|---|
| *This post needs a media host* | Set up a host (section 2). |
| *Uploading to the S3 bucket failed (HTTP 403)* | Wrong keys, bucket name, region or endpoint; the key needs write access to the bucket. |
| *The media file is not publicly reachable* | The "already hosted" URL does not return the file; check the base URL. |
| *Meta refused the request because a permission or Page role is missing* | Add the permissions in section 1 and renew the token; for Pages check the `CREATE_CONTENT` task. |
| *Could not get a publishing token for the Page* | You no longer manage the Page, or the token lacks `pages_show_list`. |
| *Meta could not process the media* | The file breaks a limit Meta checks after upload (codec, bitrate, ratio). Re-export it (H.264 + AAC, 30 fps, 9:16 for reels). |
| *The 24-hour publishing limit is reached* | MetaDash retries automatically; spread posts out. |
| *Cannot tell whether the post went live* | Check the account. Retry only if the post is missing. |
| *Missed: MetaDash was not running* | Use the queue to publish, reschedule or skip; enable tray mode and launch at login. |
