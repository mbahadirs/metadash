# Known limitations

[Türkçe](tr/known-limitations.md)

This page lists what MetaDash 2.0 cannot do, and where it relies on platform API behaviour that we could not fully confirm from the official documentation. Platforms change their APIs often. If something below does not match what you see, please [open an issue](https://github.com/mbahadirs/metadash/issues/new) and include the platform, what you did, what MetaDash showed, and, if possible, the error code and `fbtrace_id` from the sync log or the post's log. Never paste tokens or secrets into an issue.

## General

| Limitation | Details |
| --- | --- |
| **Unsigned builds** | Release builds are signed only when signing secrets are configured, so macOS Gatekeeper and Windows SmartScreen may warn you on first launch. See [Unsigned builds](../README.md#unsigned-builds). On macOS and with the `.deb` package, updates are not installed automatically. |
| **Background publishing needs MetaDash running** | Instagram, Threads and Facebook posts that MetaDash sends are published only while the app runs (the window can be closed in tray mode) and the computer is awake. Only Facebook posts with **Schedule on Facebook** go out while the computer is off, unless you use the [self-hosted worker](worker.md). See [Publishing setup, section 3](publishing-setup.md#3-what-works-while-the-computer-is-off). |
| **Public media host for Instagram images and Threads** | Meta downloads Instagram images and all Threads media from a public URL. You need your own S3-compatible bucket (or the experimental Facebook Page host, or files you already host). See [Publishing setup, section 2](publishing-setup.md#2-media-hosting-instagram-and-threads). |
| **Publishing platforms** | Publishing is available for Instagram, Facebook Pages and Threads. YouTube and TikTok are analytics only (plus the YouTube inbox). |
| **No direct messages** | The inbox handles comments only. Instagram and Facebook messaging need extra permissions, App Review and webhooks. |
| **AI features are beta** | AI features are off by default and need your own API key or a local Ollama model. They are tested against stubbed providers and a limited set of real models. Token and cost figures are estimates. |
| **Team roles are guardrails** | Roles and the client view are not a security boundary. See [Team](team.md). |
| **Languages** | English and Turkish are complete. German and Spanish are partial; untranslated text appears in English. |
| **Special days** | The special-days list for content ideas is approximate. Ramadan and the Islamic holidays come from a small table for 2026–2028 and can differ by a day, so check them against the Diyanet calendar. |
| **macOS login start** | On macOS 13 and later, macOS no longer reports that an app was opened at login. MetaDash treats a start within 5 minutes of boot as a login start (for "Start hidden at login"). |

## Instagram

| MetaDash assumes | If you see something else |
| --- | --- |
| A caption can contain up to **20 @mentions**. | Meta rejects a post with fewer mentions, or accepts more. |
| A carousel can have **2–10 items**, and carousel videos can be up to **60 seconds** long. | A valid carousel is refused, or longer carousel videos are accepted. |
| A comment reply can be up to **2,200 characters** (the caption limit). Meta does not document a separate limit. | A reply under 2,200 characters is rejected for its length. |
| Instagram images must be fetched from a public URL, and presigned S3 links (with a query string) work. | Meta refuses presigned links. Set a **Public base URL** for your bucket as a workaround ([Publishing setup, 2.1](publishing-setup.md#21-cloudflare-r2-step-by-step)). |

MetaDash suggests 3–5 hashtags as a best practice, although Instagram allows 30. This is a suggestion, not an API limit.

## Facebook Pages

| MetaDash assumes | If you see something else |
| --- | --- |
| A Page post caption can be up to **63,206 characters**. | Long captions are rejected below that length. |
| Photos can be up to **10 MB** (some Meta pages say 4 MB). | Photos between 4 and 10 MB fail to upload. |
| An album can have up to **10 photos** (a practical `attached_media` limit). | Albums with more photos work, or 10 fails. |
| **Schedule on Facebook** accepts a time **10 minutes to 30 days** ahead (Meta's references say 30 or 75 days). | Times further ahead are accepted, or times under 30 days are refused. |
| Album photos for scheduled posts are uploaded with `temporary=true`, and scheduled videos are reconciled and rescheduled through the video object. | A scheduled album or video on Facebook is missing, duplicated or cannot be rescheduled. |
| Hiding a comment needs `pages_manage_engagement`. | Hide fails with a permission error even though you granted that permission. |
| A comment reply can be up to **8,000 characters**. | Replies under 8,000 characters are rejected for length. |

## Threads

| MetaDash assumes | If you see something else |
| --- | --- |
| A post can have at most **1 topic tag** and **5 links** within 500 characters. | Meta accepts more, or refuses fewer. |
| `alt_text` is accepted on image and video containers. | Posts with alt text fail, or the alt text is missing on Threads. |
| Replying from the inbox needs `threads_manage_replies` and `threads_content_publish`. MetaDash waits up to about 30 seconds before publishing a reply (text replies are usually ready at once). | Replies fail with a permission error, or take much longer. |

## YouTube

| MetaDash assumes | If you see something else |
| --- | --- |
| YouTube Analytics accepts per-video queries (`dimensions=video` with a list of video ids, up to 200 per call). If Google refuses, MetaDash falls back to the public statistics from the Data API. | Watch time or average view duration is missing for all videos. |
| Analytics can report each video's content type (Shorts, video, live). If it cannot, videos of up to 3 minutes are counted as Shorts. | Shorts are classified wrongly. |
| The uploads playlist lists videos newest first. | Older videos are missing after a sync. |
| Comment threads include only some replies; MetaDash fetches the rest separately. | Replies are missing or duplicated in the inbox. |
| "Hide" means holding the comment for review (`heldForReview`), and "unhide" publishes it again. Both need the `youtube.force-ssl` scope. | Hidden comments behave differently in YouTube Studio. |
| A comment reply can be up to **10,000 characters**. | Shorter replies are rejected for length. |
| The Analytics API quota is separate from the 10,000 daily Data API units. Rate-limit errors are retried with backoff. | Syncs stop with a quota error that MetaDash does not explain. |
| Daily Analytics rows arrive 2–3 days late and are revised, so MetaDash re-reads the last 7 days. | Older days keep changing after a week. |

Other YouTube limits: while your OAuth consent screen is in **Testing**, Google refresh tokens expire after **7 days** and you must reconnect weekly; publish the consent screen to avoid this ([YouTube setup, section 2](youtube-setup.md#2-configure-the-oauth-consent-screen)). Each Google Cloud project has **10,000 Data API units per day**. Content-owner (CMS/MCN) reports are not supported.

## TikTok (experimental)

TikTok's Display API gives third-party apps much less data than Meta or Google. There are no per-day analytics, reach, watch time, demographics or comments. MetaDash **estimates** daily views and new followers from the differences between syncs. Sandbox apps are limited to 10 target users. See [TikTok setup](tiktok-setup.md).

| MetaDash assumes | If you see something else |
| --- | --- |
| Sandbox apps return real counts for their target users. | All counts are zero or fake in sandbox mode. |
| Photo posts are not part of the video list (or appear as videos). | Photo posts show up with wrong numbers, or break a sync. |
| `view_count` for your own videos equals the public play count. | Views in MetaDash differ from the TikTok app. |
| The redirect `http://127.0.0.1:*/callback/` matches every local port MetaDash picks. | Sign-in fails with a `redirect_uri` error on some attempts. |
| The paste-code fallback (Web platform with an HTTPS callback page) works with PKCE. TikTok documents PKCE only for desktop and mobile. | The code is rejected with a *code verifier* error. Use the loopback sign-in instead. |

## Meta, across platforms

| MetaDash assumes | If you see something else |
| --- | --- |
| Meta counts caption length the way MetaDash does: emoji count as one character, and MetaDash warns close to the limit. | A caption that MetaDash accepts is refused as too long. |
| Error subcodes: 2207042 means the daily publishing limit, 2207008 and 2207020 mean expired media, and 2207001, 2207003, 2207032 and 2207053 are temporary. Meta documents these only in part. | A post is retried when it should fail, or fails when a retry would have worked. |
| First comments on Facebook and Threads need the scopes listed in [Publishing setup](publishing-setup.md#1-permissions). | The post goes out but the first comment is refused. |
| The worker accepts a token with the minimum publishing scopes listed in [worker.md](worker.md#what-the-worker-gets-and-what-it-never-gets). | The worker refuses a token that has those scopes, or publishing fails with it. |

## AI providers

| MetaDash assumes | If you see something else |
| --- | --- |
| Every Claude model in the list accepts images. OpenAI models are treated as image-capable by name, and Gemini 1.5 and later are multimodal. | "Your model can't see images" is wrong for your model, or image requests fail. MetaDash retries without images when a model rejects them. |
| OpenAI accepts JSON schema responses, Gemini accepts JSON mode, and Ollama 0.5 or later supports structured outputs. | Studio features fail because the model's answer has the wrong format. Update Ollama if it is older. |
| Token estimates use about 4 characters per token (Turkish text is denser), and image token costs follow each provider's published formula. | The cost estimate differs a lot from your provider's bill. Prices come from a built-in table that can go out of date. |
