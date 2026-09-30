# Unified inbox

[Türkçe](tr/inbox.md)

The inbox collects comments from every connected platform in one list: Instagram, Facebook Pages, Threads and YouTube. TikTok has no inbox, because its API does not give third-party apps access to comments. It lives at **Inbox** in the sidebar. The Studio → Inbox tab and each account's **Inbox** tab show the same view.

Direct messages are not included. Instagram and Facebook messaging need extra permissions, App Review and webhooks, so they are a candidate for a later version.

## What you can do

- **Filter.** Show Unanswered, Overdue, Replied, Done or All comments. You can narrow by platform, account, sentiment and assignee, show questions only, or search. The list is virtualised, so large inboxes stay fast.
- **Reply.** Write a reply yourself, or ask AI for suggestions in your brand voice. MetaDash never sends a reply on its own: each reply needs an explicit confirmation. The dialog also warns you when the reply mentions a third party.
  - The character counter uses each platform's limit: Instagram 2,200*, Facebook 8,000*, Threads 500, YouTube 10,000*.
  - (*) These limits are not documented by the platform. See [Known limitations](known-limitations.md).
- **Workflow.** Mark a comment done (it leaves the inbox without a reply), ignore it, reopen it, or assign it to a teammate. In a team, status and assignment changes sync through the shared folder.
- **Hide.** Hide or unhide a comment on the platform, where the platform allows it.
- **Keyboard.** `j` / `k` move through the list, `e` marks the comment done, `r` jumps to the reply box.
- **Response time.** The Response time tab shows first-response KPIs and a table per account.
- **Reports.** Client reports (monthly, weekly client, custom) include a "Community response" section in both HTML and Excel.
- **Notifications.** You get a notification when comments wait longer than the target, and when new unanswered comments arrive (at most once every 6 hours).

## How comments arrive

- **Full or organic sync.** When comment sync is on, each sync fetches comments through the platform's inbox adapter.
- **Background polling.** While MetaDash (or its tray) runs, it checks for new comments every 30 minutes. This polling runs as sync scope `inbox` and is skipped when another sync is running.
- **Refresh button.** "Refresh comments" fetches immediately. From the command line, `metadash inbox pull` does the same.

Which posts are polled:

- every post from the last 14 days;
- older posts (up to 90 days) whose synced comment count went up since the last poll.

Stories are skipped. Poll state is kept per post in `inbox_cursor`.

## Metrics

- **First response time (FRT):** the time from a comment to the account's first reply to it.
  - Only top-level comments from other people count.
  - Comments closed as done or ignored without a reply are left out.
- **Answered %:** comments that have an owner reply, divided by incoming comments.
- **Within target %:** comments answered within the target (24 h), divided by eligible comments.
  - A comment is eligible once it has been answered, or once it is older than the target.
  - A fresh comment does not count against you yet.
- **Median / p90** FRT, and **backlog** (unanswered comments older than the target).
- **Health score:** the *response* component is 50 % answered rate + 50 % within-target rate. Platforms without an inbox (TikTok) keep the re-weighted score.

## AI sentiment (optional)

An offline rule always marks questions. It looks for a question mark or a question word in English, Turkish, German or Spanish.

AI labels are optional: positive, neutral, negative, question, complaint, spam.

- **When it runs.** Only when AI is enabled, and either you press **Classify with AI** or the `inbox.aiSentiment` setting is on.
- **Preview first.** Before anything is sent, you see the number of comments and the estimated tokens.
- **What is sent.** Comments go in batches of 50, with local numeric ids.
  - Commenter handles are replaced with `@user1…`.
  - Comment text is quoted as data, and the model is told never to follow instructions inside it.
- **What is skipped.** Accounts that opted out of AI are never sent. A comment is only classified again if its text changes.

## Permissions

The rows below were checked against Meta's permission reference and Google's YouTube API documentation on 2026-09. Items marked VERIFY are not confirmed (see [Known limitations](known-limitations.md)).

| Platform | Read | Reply | Hide |
|---|---|---|---|
| Instagram | `instagram_basic`, `instagram_manage_comments` | `instagram_manage_comments` | `instagram_manage_comments` |
| Facebook Page | `pages_read_engagement` + `pages_read_user_content` (comments by users; without it the author shows as "Facebook user") | `pages_manage_engagement` (Page role with the MODERATE task) | `pages_manage_engagement` (VERIFY) |
| Threads | `threads_basic`, `threads_read_replies` | `threads_manage_replies` + `threads_content_publish` | `threads_manage_replies` |
| YouTube | `youtube.readonly` | `youtube.force-ssl` (**Enable replying** in Settings → Connections) | `youtube.force-ssl` (held for review; VERIFY) |

- **Meta.** `pages_read_user_content` and `pages_manage_engagement` are optional scopes of the Meta connection. Reconnect Meta and grant them to read and reply on Pages.
- **Threads.** The inbox scopes are requested together with the publishing scopes when **Also request publishing permission** is on (Settings → Connections). Add them to your app's Threads use case first.
- **YouTube.** Reading needs no extra step. Replying and hiding need **Enable replying** next to the channel, which asks Google again for `youtube.force-ssl`. Each reply or moderation call costs 50 quota units ([youtube-setup.md](youtube-setup.md#6-quota)).
- **When a permission is missing,** the reply box is disabled and names the missing permission.

## Settings

The following keys in the settings table are read with safe defaults:

| Key | Default | Meaning |
|---|---|---|
| `inbox.poll` | on | Background polling |
| `inbox.pollMinutes` | 30 | Polling interval |
| `inbox.lookbackDays` | 14 | How far back posts are always polled |
| `inbox.slaHours` | 24 | Reply target |
| `inbox.aiSentiment` | off | Classify new comments after each poll |
| `notify.inbox` | on | Inbox notifications |

## Data

- **`comments`:** one table for every platform.
  - Keys: Instagram raw id, `fbc-`, `th-`, `ytc-`.
  - It also stores `platform`, `account_id`, `external_id`, `is_hidden`, and more.
- **`inbox_state`:** workflow status, assignee, first response, question flag and sentiment.
- **`comment_replies`:** reply suggestions and the outbox.
  - Status flow: `sending` → `sent` or `failed`.
  - A crash while sending is resolved safely. If a matching owner reply exists, the attempt is marked sent; otherwise it is marked failed so you can retry.

## CLI

```
metadash inbox pull [--account @x]…
metadash inbox sla [--from YYYY-MM-DD --to YYYY-MM-DD] [--platform p]… [--json]
metadash inbox list [--status open|overdue|replied|done|all] [--limit n] [--json]
```
