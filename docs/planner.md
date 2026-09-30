# Planner

[Türkçe](tr/planner.md)

The Planner is MetaDash's content calendar: plan posts for Instagram, Facebook Pages and Threads, get them approved, and publish them. Publishing needs extra permissions and, for Instagram images and Threads media, a media host; see [publishing-setup.md](publishing-setup.md). The AI assist in the composer is described in [ai-studio.md](ai-studio.md).

## Opening the Planner

**Planner** in the sidebar (calendar icon) opens the content calendar. The toolbar has an account filter, the global platform filter (shown when more than one platform is tracked) and **New post**. The screen has five tabs:

| Tab | What it shows |
| --- | --- |
| **Calendar** | Month or week view of scheduled posts, plus an **Unscheduled** list of drafts without a time |
| **List** | Every post in a table with status filters, search (title, caption or `P-0042` reference) and bulk status changes |
| **Queue** | The publishing queue: each account's target with its state, next attempt, last error, retry/cancel, daily quota meters, the pause switch and the missed-posts banner |
| **Approvals** | Posts in review, with changes requested or approved; manual approval, approval-pack export and client-response import |
| **Log** | The audit log of every change (who, what, when), newest first |

Deep links work too, for example `#/planner?tab=queue&missed=1` (used by notifications and the tray) or `#/planner?post=12` (opens post 12).

## Calendar

- **Month** shows six weeks; each day lists up to three posts and a "+n more" link that opens that week. **Week** shows a 7 × 24 hour grid that scrolls to 08:00.
- A post chip shows the time, platform marks, a coloured bar for the status, a red dot when validation has errors and a ✓ when the post is already scheduled on Facebook ("Scheduled on Facebook" keeps working while your computer is off).
- **Drag and drop:** drag a post to another day (month view keeps the time of day) or hour (week view sets the time, snapped to 15 minutes from where you drop it). Hold **Alt/Option** while dropping to create a copy instead of moving. Drops into the past are refused. Dragging a calendar post onto **Unscheduled** removes its time (not for scheduled posts; unschedule them first). The calendar updates immediately and rolls back if the change fails.
- **Keyboard:** Tab to a post and press **Enter** to open it, **R** to open the reschedule dialog (date/time, "duplicate instead of moving", clear time), **Alt+←/→** to move by a day and **Alt+↑/↓** by 15 minutes (add **Shift** to duplicate).
- **Best times:** with a single account selected, the week view tints the suggested hours (from your posting history; see best-time suggestions).
- The **+** in a day or hour cell starts a new post at that time.

## Composer

Clicking a post (or **New post**) opens the composer on the right (full width on narrow windows).

- **Accounts:** pick any mix of Instagram, Facebook Page and Threads accounts. Each selected account gets a format (Auto picks one from the media: one image → image/photo, several → carousel/album, a video → reel or video; you can override it), a **Schedule on Facebook** switch for Pages (Facebook publishes the post itself, so it works while your computer is off) and a link field for Facebook link posts. Accounts without publishing permission are marked.
- **Media:** add files with **Add files**, drop them from Finder/Explorer, or paste an image. Files are copied into MetaDash's media library (`<data folder>/planner-media`); duplicates are stored once. Reorder with drag and drop or the ← / → buttons, add alt text, click a thumbnail for a full preview with its size, dimensions, duration and codec. Media with problems get a coloured border.
- **Caption:** one shared caption and first comment, plus a tab per account for a custom caption or first comment. Live counters show characters (emoji count as one), hashtags and mentions against each platform's limit (Instagram 2,200 characters / 30 hashtags / 20 mentions, Facebook 63,206, Threads 500 characters / 1 topic tag / 5 links).
- **Schedule:** date and time in your computer's time zone, and best-time chips for the selected accounts. Changing the time of a saved post applies right away.
- **Checks:** the post is validated as you type (formats, media counts and sizes, aspect ratios, video duration/codec, time in the past, missing media host or permissions, quota, posts too close together). Errors block scheduling; warnings and notes don't.
- **Preview:** an approximate Instagram / Facebook / Threads preview per account.
- **Publish via:** *This computer* (default) or *Worker*, per account, when a [self-hosted worker](worker.md) is connected. Posts handed to the worker are published even while your computer is off.
- **Saving:** a new post is created with **Save draft** (Cmd/Ctrl+S) or by the first workflow action. After that, edits save automatically. If the post was changed somewhere else in the meantime, a banner lets you load the latest version or overwrite it. Closing a new unsaved post asks before discarding it.
- **Results & history:** for saved posts, a second tab lists each account's publish state, link to the live post, publish time, attempts, next attempt and the last error with Meta's error code and `fbtrace_id` (useful for support), with per-account **Retry** and **Cancel**, followed by the post's history.

## Workflow

A post moves through **Draft → In review → Approved → Scheduled → Published**. The composer's bottom bar shows the steps that apply:

| Status | Actions |
| --- | --- |
| Draft | Submit for review, Schedule (unless approval is required), Archive, Delete |
| In review | Approve (optional approver name), Request changes (with a note), Back to draft |
| Changes requested | Submit for review, Back to draft |
| Approved | Schedule, Back to draft |
| Scheduled | Unschedule, Publish now |
| Failed / Partly published | Retry |
| Archived | Restore |

Every post can be duplicated. When **Require approval before scheduling** is on (Settings → Publishing), a draft can't be scheduled directly, and changing the content of an approved or scheduled post sends it back to review. Moving a post in time never invalidates an approval.

## List, queue and log

- **List:** select rows (checkboxes or Space) and use the bulk bar to submit for review, approve, move back to draft or archive. Posts that can't take the step are skipped and the reason is shown.
- **Queue:** shows what the publisher will do next. **Publishing on/off** pauses all publishing. Posts that were due while MetaDash wasn't running are listed in a banner with **Publish now**, **Reschedule** (to a time you pick) and **Skip**.
- **Log:** the full audit trail; **Load more** pages back in time.

Everything in the Planner works in both themes and in every UI language.

## Best-time suggestions

The composer and the week view suggest publishing slots for the selected account(s):

- The suggestions use the engagement rate of your synced posts from the last 180 days, grouped by weekday and hour. Hours are in this computer's local time, the same as the Best time heatmap.
- An hour slot with at least 3 posts uses its own average ER. An hour slot with fewer posts is pulled toward the account's overall average (shrinkage, k = 3), so a single lucky post does not dominate.
- If the selected accounts have fewer than 10 posts with engagement data, MetaDash uses every tracked account on the same platform instead (**portfolio**). If that is not enough either, it falls back to a generic grid of typical posting hours (**default**). Each suggestion says which of the three it came from.
- Slots less than 15 minutes away are never suggested. Neither are slots within *Minimum gap between posts* (Settings → Publishing, default 3 h) of another scheduled post on the same account. Suggestions are also kept at least that far apart from each other. A slot that conflicts with an existing post is offered only when nothing else fits, and it shows the conflicting post.

## Client approval

### Workflow

`Draft → In review → Approved → Scheduled`. A client can instead ask for changes (`Changes requested`). If **Require approval before scheduling** is on (Settings → Publishing), a post can only be scheduled after approval. Editing the content of an approved post sends it back to review; changing only its time does not.

### Approval packs

**Planner → Approvals → Export pack** saves a single file for your client. It needs no server, account or login.

- **HTML:** one self-contained file. It has your report branding (logo, agency name, accent colour, footer), and each post shows its reference (e.g. `P-0042`), date and time, target accounts, a preview with images, the caption, per-platform caption changes, the first comment and the content version. Internal notes are left out unless you tick *Include notes*. The client opens the file in any browser, picks **Approve** or **Request changes** with an optional comment for each post, enters their name and presses **Copy response**. That produces a code starting with `MDAP1.`, which they send back by email or chat. The page never connects to the internet.
- **PDF:** the same content for printing or reading on a phone. It has no form, so the client replies by email quoting the references (e.g. "P-0042: approved").

Paste the client's code into **Planner → Approvals → Import response**:

- **Applied:** the decision is recorded in the post's log with the client's name. Drafts are moved through *In review* automatically.
- **Stale:** the post was edited after you exported the pack, so the client approved content that no longer exists. Nothing changes. Send a new pack.
- **Unknown:** the post was deleted, or the reference is not in that pack.
- **Not applied:** for example, a scheduled post that received *Request changes*. Unschedule it first. The comment is still saved in the log.

The code carries a short checksum that catches codes which were cut off or pasted into the wrong pack. It is **not** a signature, because the key is inside the pack file. Treat a response as you would the client's email. Approvals received by email or WhatsApp can also be recorded manually with **Mark approved** and the approver's name.

## Running in the background

MetaDash publishes posts that MetaDash itself sends (Instagram, Threads, and Facebook in app mode) only **while it is running and the computer is awake**. Only posts scheduled on Facebook itself ("Schedule on Facebook") publish while the computer is off. Settings are in **Settings → Background mode**.

| Setting | What it does |
|---|---|
| Keep running in the tray / menu bar | Closing the window does not quit. The window is closed to free memory, and the app stays in the system tray (Windows/Linux) or the menu bar (macOS, where the Dock icon is hidden while no window is open). The first time you close the window, a notification explains this. |
| Launch at login | macOS/Windows: a login item. Linux: `~/.config/autostart/metadash.desktop` (pointing at the AppImage when you use one). Development builds do not register it. |
| Start hidden at login | With tray mode on, a login start opens no window, only the tray icon. On macOS 13 and later, macOS no longer tells apps they were opened at login, so MetaDash also treats a start within 5 minutes of boot as a login start. |
| Keep the computer awake… | Blocks app suspension from 10 minutes before to 5 minutes after each post that MetaDash sends. A closed laptop lid still sleeps. |

**Tray menu:** the next post (e.g. "Next: Tue 14:00 · @brand (IG)"), how many posts are left today, Pause/Resume publishing, Sync now, Open MetaDash, Open Planner and Quit. The menu refreshes every minute and whenever the planner changes. On Windows/Linux, a left click opens the window. On some Linux desktops (for example GNOME without the AppIndicator extension), tray icons are not shown.

**Quitting:** if posts that MetaDash sends are due within 2 hours, **Quit** asks first ("N posts won't publish while MetaDash is closed"). Installing an update and shutting down the computer never ask.

**One copy at a time:** opening MetaDash again brings the existing window to the front instead of starting a second copy, which could publish a post twice.

**After sleep:** when the computer wakes or the screen is unlocked, MetaDash checks the queue immediately. Posts whose time passed while it slept or was closed are handled by **Missed posts** (Settings → Background mode):
- *Ask me* (default): you get a notification, and the Queue tab offers Publish now, Reschedule or Skip.
- *Publish late*: posts up to *Latest late publish* minutes late are published.
- *Skip*: the posts are marked missed.
