# Read a conversation's existing Zalo Web history

Version 0.2.0 adds `zalo_web_conversations`, `zalo_web_history` and
`zalo_web_status`. These read the authorized browser's existing message database,
including records from before this package was installed. They do not depend on
our listener having received the messages. The original `zalo_history` remains a
query of the separate listener cache; use the `web_` tools for web history.

## What the web application actually does

Inspection of the public Zalo Web 26.10.20 assets and a user-authorized test tab
on 2026-10-25 established:

- The active account has an IndexedDB database named `zdb_<account>`.
- The message index `userId_sendDttm_msgId` orders by `toUid`, `sendDttm`, `msgId`.
- Raw message bodies can be encrypted. The app's already-loaded storage query
  builder decodes them in the page. This package calls only its read method;
  it never extracts the storage key, cookies or credentials.
- The inspected app uses a loaded `fsN4` query-builder module. If that supported
  reader is unavailable, we fail closed rather than returning ciphertext.
- The inspected cloud-history path has group/self-chat feature gates. Its
  existence does not establish a universal HTTP history endpoint for private DMs.
- Messages which have never reached this browser are not present. Use Zalo's
  normal phone-confirmed synchronization in the web UI when needed.

Public source references (not redistributed in this repository):
[web app](https://chat.zalo.me/),
[message loader](https://zalo-chat-static.zadn.vn/v1/lazy/1.eddd11e30e151903e701.js),
[storage facade](https://zalo-chat-static.zadn.vn/v1/lazy/default-embed-render.2bae787e513bad5fdb28.js).

## Connect the browser on the agent's machine

This adapter requires a **user-authorized loopback Chrome DevTools endpoint**.
It cannot automatically attach to an ordinary Chrome tab without that endpoint.
An agent browser extension connection alone does not imply an HTTP CDP endpoint.
No cookies are exported from your normal browser and no Chrome restart is
performed by this package.

If the agent already has a dedicated browser with a local CDP endpoint, use it.
Otherwise launch a **separate, Zalo-only profile** and scan in that profile once.
For example on macOS, in a terminal:

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --user-data-dir="$HOME/.local/share/zalo-history-browser" \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9222 \
  https://chat.zalo.me/
```

On Linux use your installed Chrome/Chromium executable with the same flags and
an appropriate persistent profile directory. Protect that directory as private.
Do not expose this port to the network or use a general browsing profile: CDP
itself can control the entire debugging browser, even though our tools cannot.
Do not use insecure certificate flags or `--remote-allow-origins=*`.
Stop an existing Zalo listener before signing into another web session for the
same account. This package never silently logs in, takes over, or closes a tab.

When upgrading an existing installation, run `zalo-readonly shutdown` first
to stop the old daemon, then install v0.2.0. An already-running v0.1.0 daemon
does not load new tools until restarted.

After the web UI is logged in and shows the history you need:

```sh
zalo-readonly web-connect '{"endpoint":"http://127.0.0.1:9222"}'
zalo-readonly web_status
zalo-readonly web_conversations '{"limit":50}'
zalo-readonly web_history '{"thread_id":"10001","limit":50}'
zalo-readonly config
```

`10001` is fictional; use a `thread_id` returned by `web_conversations`.
If more than one Zalo tab is present, connection fails until you explicitly
supply its `target_id` from the local `/json/list` debugger listing. Do not post
that listing publicly; it may contain unrelated private tab URLs.

Attach stores only the loopback endpoint, target ID and account ID with mode 0600.
It does not start a second Zalo WebSocket. The browser owns its normal session.
The adapter reads only the attached account and target; changing accounts or
closing/replacing the tab requires explicit reconnection.

## Pagination and coverage

Pass `next_before` back as `before` without changing it:

```sh
zalo-readonly web_history '{"thread_id":"10001","limit":50,"before":{"sent_at":"1700000000000","message_id":"20002"}}'
```

The timestamp and message ID are strings matching the browser's compound index.
This cursor excludes the preceding page's last record, including timestamp ties.
The `web_conversations` cursor is `next_after`, passed as `after`.
Bind cursors to the returned account ID and conversation.

- `source: browser_local_store` identifies decoded browser history.
- `has_more: false` exhausts this browser's queried records, **not** all phone
  or server history. `complete` always remains false.
- Text is capped at 16,384 characters per record with `text_truncated`; non-text
  messages return metadata and `non_text: true`, not attachment URLs/payloads.
- No messages are copied into the listener's SQLite cache. Browser and listener
  account IDs are reported separately, preventing cross-account cache mixing.
- Existing search/events tools still query the listener cache, not browser data.
- The reader does not open a conversation, scroll it or send read receipts.
  Zalo's own UI may independently mark messages read when the human uses it.

Run `zalo-readonly web-disconnect` to forget the binding. This leaves Chrome and
its session open. Close the dedicated browser yourself when finished to stop its
CDP endpoint. It is not necessary to run `login`/`resume` in browser-history mode.

## Validation and limits

The exact repository reader was run in the user-authorized existing Zalo tab:
2 conversations, 1 pre-existing message, decoded text matched the visible page,
exclusive pagination and account mismatch rejection passed. No private messages,
account IDs, database exports or session credentials were saved as fixtures.

Offline tests exercise the same reader against synthetic IndexedDB data,
equal-timestamp pagination, per-thread isolation, unsupported decoders, account
changes, loopback/target restrictions and an actual HTTP/WebSocket transport
with a synthetic CDP server. The transport was **not** attached to the user's
normal Chrome profile in this test; the live reader was verified through DevTools.
Large archives, other web builds, groups and encrypted-message variants still
need validation in their respective environments. This is an experimental
version-specific adapter, not a guarantee of future Zalo compatibility.
