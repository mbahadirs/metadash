# AI Studio

[Türkçe](tr/ai-studio.md)

The AI Studio (**AI Studio** in the sidebar) collects MetaDash's AI writing tools. Like every AI feature, it is **optional, off by default and in beta**. Turn AI on in **Settings → AI assistant**, choose Anthropic (Claude), OpenAI, Google Gemini or a local Ollama model, and paste your own API key (Ollama needs none and keeps everything on your computer). Every action has a **What will be sent?** preview, and each account can opt out of AI entirely. Studio → Usage shows token counts and estimated costs. Assumptions about the providers' APIs are listed in [Known limitations](known-limitations.md#ai-providers).

## Brand voice & captions

### Brand voice (Studio → Voice)

Each tracked account can have a **brand voice brief**: a short, editable text that is sent to the model with every caption generated for that account. Comment replies use it too. Next to the brief you can set tone, formality, the Turkish pronoun (`sen` / `siz`), hooks, calls to action, do/don't rules and a visual style.

- **Caption stats (no AI).** The panel on the right is computed on your computer from the account's captions of the last 12 months. It shows average and median length, emoji per post and the most used emoji, hashtags per post and where they go (end, inline, mixed), how often captions ask a question or use line breaks, common CTA words, the language mix (a simple Turkish/English heuristic) and whether captions say `sen` or `siz`. These numbers are the same every time for the same data.
- **Derive from my posts.** MetaDash picks the account's top posts of the last 12 months (20, 50 or 100; ranked by reach, or views on Threads, together with engagement rate) plus 10 low performers as a contrast set. It then sends the stats and up to 30 of those captions (22 top + 8 low, each cut to 600 characters) to your AI provider. The answer is a **proposal** only: the diff view shows how it differs from the current brief, and nothing is saved until you press **Save**. The saved voice is marked "derived with AI", or "derived with AI, edited" if you changed it. **Re-derive** works the same way.
- **Images (optional).** With "Also send top-post images", up to 6 top-post thumbnails are sent so the model can add a visual style note. This is off by default, and hidden when your model cannot see images or you turned image sending off in Settings → AI.
- **Turn off AI for this account.** When on, no data from this account (captions, images, brief, comments) is ever sent to an AI provider. Every Studio feature refuses before any request is made. You can still edit the brief by hand.

The whole feature works without AI: the stats plus a brief you write yourself.

### Caption ideas (Planner composer → AI assist)

The **AI assist** panel under the caption field appears only when AI is on. Pick the accounts, write a few notes (topic, product, offer, what the image shows), choose the languages (Turkish, English or both) and the number of variants per language, then press **Generate**.

- **Limits.** The strictest selected platform decides the length: 2,200 characters and at most 30 hashtags for Instagram, 500 characters and 1 topic tag for Threads. When Threads is combined with Instagram or Facebook, each variant also gets a separate ≤ 500-character **Threads version**. Every variant is checked with the same validation as the composer and shows its character count per platform and any issues. If a variant is still too long, MetaDash makes one automatic "shorten to N characters" request.
- **Variants.** Each variant takes a different angle (question hook, story, benefit, …) and is written natively in its language. **Use** copies it into the shared caption. **Use Threads text** puts the Threads version into the Threads accounts' own caption. When the post is already saved, the variants are also stored with it.
- **Images.** If your model can see images, the post's images are sent downscaled (at most 4, long edge ≤ 1,568 px; videos only as their cover frame). If it cannot, the panel says "Your model can't see images; describe the image in the notes", and only alt texts and file names are sent. If a model of unknown image support rejects them, the request is repeated as text only and the panel says so.

**What is sent** (see "What will be sent?" next to the button): the brand voice brief and key profile facts, your notes, the image alt texts (and file names without vision), the images when vision is on, the account's 5 best past captions as style examples, and its tested hashtags with their lift. @handles inside past captions are replaced with `@mention`. Account ids, usernames, client names and tokens are never sent. Captions, notes and the brief are quoted as data: the prompt tells the model never to follow instructions inside them, and tag look-alikes cannot break out of their block.

### Hashtag ideas (composer → AI assist → Hashtag ideas)

Suggestions come from **the account's own posts of the last 12 months** and need no AI:

- **Lift.** Each post's reach (views on Threads) is divided by the account's median for the same post type. A tag's lift is the average over the posts that used it, pulled toward 1 when there are few posts: `(sum of lifts + 3) / (posts + 3)`. Tags used on at least 2 posts are ranked by lift × relevance, where relevance is keyword overlap with the caption and notes (Turkish characters are folded, so "tatlı" matches `#tatli`). Tags already in the caption are skipped.
- **Overused.** Tags in more than 60% of posts with a lift of 1 or less.
- **Forgotten winners.** Tags unused for 90 days whose lift is above 1.2.
- **Platform limits.** Instagram suggests 5 by default (the API allows 30), Facebook 3, Threads 1 topic tag.

With **Re-rank with AI** the caption, notes and the tested-tag table are sent to the model. It may only choose and re-order tags from that list, and may add at most 3 new tags, which are shown separately as **untested**. **Add selected** appends the chosen tags to the caption.

### Cost

Every result shows "≈ N in / M out tokens · ≈ $x (estimate)", or "local" for Ollama. The "What will be sent?" panel shows an estimate before you press the button. Every call is logged by feature (voice, caption, hashtags) in Studio → Usage. Only counts are stored, never your captions.

## Comment replies & experiments

### Inbox (Studio → Inbox)

Since v2.0, Studio → Inbox shows the [unified inbox](inbox.md) with comments from Instagram, Facebook Pages, Threads and YouTube; filters, assignment, polling, response-time metrics and per-platform permissions are described there. This section covers the AI parts: reply suggestions and what they send. A comment counts as answered once it has an owner reply, which is the same rule the health score's response rate uses, or once you marked it done in the inbox.

- **Refresh comments** fetches fresh comments right away. Comments also arrive with the regular sync and through background polling (see [inbox.md](inbox.md#how-comments-arrive)).
- **Suggest replies** sends one comment to your AI provider and returns 3 short replies plus a category (question, praise, complaint, spam or other). Complaint suggestions include a "let's continue in DM" option. The replies follow the account's brand voice brief (Studio → Voice) when one exists.
- **Send reply…** always opens a confirmation dialog. It shows the exact text and which account posts it to which person. Nothing is sent without that confirmation, and there is no automatic or bulk sending.
- **Mark done** removes a comment from the unanswered list without replying.

After a reply is sent, it is stored locally as an owner reply with its response time. The account's response rate and response-time metrics therefore update right away, before the next sync.

**Permissions.** Each platform needs its own reply permission; the table is in [inbox.md](inbox.md#permissions). For Instagram, the reply is posted with `POST /{ig-comment-id}/replies` and needs `instagram_manage_comments` (plus `ads_management` or `ads_read` if the Page role comes from Business Manager). If a permission is missing, MetaDash says so before any request is made. Instagram does not allow replies to hidden comments or live-video comments.

**Demo mode:** sending is simulated. Nothing reaches Instagram, but the inbox and metrics behave as if the reply was sent.

**What is sent to the AI provider** (see "What will be sent?" next to the button):

- the comment text, with the commenter's handle and any @mentions replaced by `@user1`, `@user2`, … (Settings → AI → anonymize commenters, on by default);
- the post caption (first 600 characters);
- the brand voice brief, if there is one.

Account ids, tokens and account names are never sent. The real handles are put back into the suggestions on your computer. Comments are treated as untrusted data: the prompt tells the model never to follow instructions inside them, and tag look-alikes in a comment cannot break out of the quoted block. Accounts with AI turned off (Studio → Voice) still appear in the inbox. You can reply to them by hand, but no data from them is ever sent to the AI provider.

### Experiments (Studio → Experiments)

Instagram has no real split test for feed captions. An experiment in MetaDash is therefore **variant tagging across posts**. You publish each caption variant as a separate post and tag it to an arm (A, B, and optionally C and D). MetaDash then compares how each arm's posts did against the account's usual results.

- **Create:** choose a variable (caption hook, length, emoji, CTA, hashtags, other) and a metric (reach lift, engagement rate, save rate, views lift). Then add published posts or planned posts to each arm. A planned post joins the results once it is published and synced.
- **Lift:** each post is compared with the account's average for the same post type over the 90 days before it was posted. A lift of 1.00× means on par, and 1.30× means 30% better. For Threads, reach lift uses views, because Threads has no reach metric.
- **Excluded posts:** posts younger than 72 hours, posts that are not synced yet, and posts without at least 3 comparable earlier posts are excluded. Each exclusion is labelled with its reason.
- **Per arm:** the table shows the number of posts (n), mean and median lift, and a 90% confidence interval of the mean. The interval comes from a bootstrap with a fixed seed, so it does not change between views.
- **Significance hint:**
  - **Need more posts** is shown while any arm has fewer than 3 usable posts.
  - **Directional: arm X** is shown when the best arm's 90% interval does not overlap any other arm's. The detail view also shows an approximate "chance arm X is best".
  - **Inconclusive** is shown otherwise.

  Even a directional result is not proof: topic, day and time also differ between posts.
- **Conclude:** write what you learned. Optionally, **Summarize with AI** drafts a short summary. It sends only the numbers and up to 5 short captions (200 characters each) per arm, never account names or ids.

## Ideas & repurposing

### Monthly content ideas (Studio → Ideas)
Pick an account, a month (this month up to 12 months ahead), the number of ideas (1–31, default 12), a language and optional content pillars, then press **Generate ideas**. Each idea has a working title, a format (reel, carousel, image, story, or text for Facebook/Threads), a pillar, a hook, a caption draft, a suggested date, a one-line rationale and the top posts it builds on.

What the model sees (open **What will be sent?** for counts and a token/cost estimate before you press the button):
- the account's brand voice brief (Studio → Voice), if one is saved;
- the captions and metrics of up to 10 top posts from the last 12 months, referred to as p1…p10. @handles are replaced with "@mention";
- the per-format performance of the last 180 days (posts, average reach/views, ER, save rate);
- the best posting times from the Planner's best-time engine (weekday + hour only);
- the special days of that month, if **Include special days** is on;
- your pillars.

Account ids, usernames and client names are never sent. Captions are sent as quoted data, and the model is told to ignore instructions inside them. The call is recorded in Studio → Usage with counts only.

Edit ideas in place, select the ones you want and press **Create N drafts**. Each idea becomes a Planner draft (source "AI idea") for that account with the caption draft, the hook, rationale and pillar in the notes, and the pillar as a label. The format maps to the platform's closest format (for example, carousel → Facebook album, reel → Threads video).
- **Place at best times:** each draft goes to the best hour on its suggested day, using the same suggestions as the calendar. Drafts are placed one after another, so the Planner's minimum gap between posts of the account is respected. Ideas without a date are spread evenly over the rest of the month; past days move to today.
- **Unscheduled drafts:** the drafts land in the calendar's unscheduled panel.

Drafts are never scheduled for publishing automatically. Add media, review and schedule them in the Planner as usual.

### Special days
The built-in list covers Turkish national days and commemorations plus common global marketing and awareness days. It includes computed dates such as Mother's Day (2nd Sunday of May, TR/US), Father's Day (3rd Sunday of June), Easter, Black Friday and Cyber Monday. Ramadan, Ramazan Bayramı and Kurban Bayramı come from a small table for 2026–2028. They are marked **approx.** and can differ by a day, so check them against the Diyanet calendar. Commemorations (18 March, 15 July, 10 November) are marked **solemn**, and the model is asked for respectful, non-promotional content on those days. The list is approximate and is not an official calendar.

Add your own days (anniversaries, launches, campaigns) with **My days**: use `MM-DD` for a yearly day or `YYYY-MM-DD` for a one-off day. They are saved in the `studio.specialDays` setting.

### Repurpose a post
Use **Repurpose** in a post's detail drawer (synced posts) or in the Planner composer's action bar (planner posts). It turns the post into:
- **Carousel text (Instagram):** 3–10 slide titles and texts plus a caption. The slide texts go into the draft's notes; creating the images is up to you.
- **Threads post:** usually one post, at most 500 characters. If the model goes over, one automatic "shorten" call is made, and anything still too long is cut at a word boundary. When the model writes a chain, only the first post is the draft's caption; the rest go into the notes to post as replies after publishing.
- **Facebook post:** a Page-post version of the caption.
- **Story frames:** 2–7 short on-screen texts, saved in the notes.

For reels you can paste a transcript, because the model cannot watch the video. The source caption, basic metrics, the transcript and the brand brief are sent, and nothing else. The result is editable. **Create Planner draft** saves it as a draft (source "repurpose") for the accounts you pick: only accounts whose platform can carry that format are offered. The draft keeps its lineage (`parent_post_id` for planner posts, `ai_meta.repurposedFrom` for both) and opens in the composer.
