# History: server replay vs phone restore

## Built-in phone sync (v0.3.0, experimental)

This implementation has **not been tested against a real account**. The official
web app was observed restoring an existing message in an isolated browser after
phone confirmation, with transfer-sync-v2 downloads. That establishes the web
flow, not the reliability or completeness of this native implementation.

Use Node 22.16+ and an already connected instance of this bridge. Do not run a
competing browser/agent listener. No fresh login is initiated by sync:

```sh
zalo-readonly sync-mobile '{"days":14}'
zalo-readonly sync-status
zalo-readonly conversations '{"limit":20}'
zalo-readonly search '{"query":"hello"}'
zalo-readonly sync-cancel
```

The request returns immediately. Poll status until `finished_best_effort`,
`finished_empty`, `failed` or `cancelled`. Phone status 3 requests confirmation;
confirm the displayed synchronization request on the phone. Declining, timeout
or disconnect can leave a partial cache. Received counts are newly inserted rows,
so a repeated successful run may insert zero. Counts never prove completeness.
The sync status is in memory and resets on daemon restart; stored records persist.
`zalo_sync_status` is the only added MCP tool; start/cancel are CLI admin methods.

Implementation:

1. Reuse the current zca-js socket after the cipher handshake. Cmd 590 requests
   conversation metadata, then message partitions in sequential groups of 20.
2. Cmd 601 transfer_sync2 controls announce phone status and encrypted batches.
3. Fetch only HTTPS `transfersync.zaloapp.com/api/transfer-sync-v2/download`,
   without cookies, with redirects refused. Signed links are never persisted.
4. Decode framed batches with the official libzproto codec, decompress Zstd,
   decode protobuf, and insert plain text (`msgType=0`) into account SQLite.
5. Release transfer sessions with cmd 591 on completion, cancellation or failure
   when the socket is still available. No reconnect or second listener is created.

First explicit use downloads official worker/WASM files into private
`sync-codecs/<build>/`. SHA-256 is pinned in sync-codecs.mjs and checked on every
load. A changed asset fails closed (`SYNC_CODEC_HASH_MISMATCH`); do not bypass the
check. No Zalo asset code or binary is distributed in this repository. The VM
separates codec globals but is not a security sandbox. Install/query/login do not
download these assets. There is no general URL or code-execution RPC.

Bounds: 1–30 requested days (default 14), 100 conversations, 100 batches/session,
50,000 message records, 16 MiB/download, 64 MiB total downloaded and decoded,
32 MiB per decompressed frame, and a 180-second transfer budget. Asset downloads
have separate 20-second request budgets. Limits fail explicitly; no unlimited
retries. Attachments, styled/non-text messages and name resolution are omitted.

Sync stores opaque thread IDs as `sync:oneone/<id>` or `sync:group/<id>`. Use
these exact IDs from conversations for history. They are **not mapped to numeric
live IDs**, so the same conversation/message may appear separately in live and
sync sources. Dedupe applies inside a sync thread, not across those namespaces.
Sender IDs may also be opaque; `is_self` remains null. Source is `phone_sync`;
never treat these rows as new incoming notifications or trigger replies.

Errors are sanitized; never publish signed URLs, keys, cookies, decoded payloads,
account directories or real message fixtures. A partial import is retained and
queryable, including after cancellation. `complete` is always false.

## Built-in replay

The bridge uses the existing zca-js socket and waits for its cipher-key handshake.
It requests cmd 510 (DM) and 511 (group), at most five pages each. The first
request uses `first: true`, `lastId: "1"`; subsequent requests use `first: false`
and the **server response's** `lastActionId`, continuing only while `more` is true.
An empty message batch does not end the queue if `more` is true. Timeouts,
invalid/repeated cursors and queue eviction are explicitly reported.

The pinned zca-js 2.2.0 `old_messages` event omits this metadata, so the bridge
observes only 510/511 responses on the same socket using that version's decoder.
No second connection is started. This is best-effort account-wide offline-queue
replay, not unlimited per-conversation history. A completed replay does not imply
that all older phone messages were delivered.

The prior implementation inferred a cursor from the last message and called the
SDK helper with `first: true` for every page. Source inspection of the actual
web app's `doGetOffline`/`onGotOffline` established the corrected protocol above.
The correction is covered by synthetic tests. An authorized native login completed both queue requests with zero records; this does not establish historical recovery.

The original prototype listened only for `message`, which is why it did not
collect historical batches. That was a script limitation, not evidence that no
history mechanisms exist.

## Optional external importer (separate upstream software)

The source-reviewed implementation at
[ardennguyen/zalo-agent-cli](https://github.com/ardennguyen/zalo-agent-cli/tree/99fd7b3964f5b29a954af4108cfd9ae81f86fda8)
version 2.5.6 implements `transfer-sync-v2`:

1. WebSocket cmd 590 requests conversation metadata; the human confirms the sync
   request on the phone (`ĐỒNG BỘ NGAY`).
2. Cmd 590 requests message partitions, in bounded batches.
3. Cmd 601 `transfer_sync2` controls provide encrypted sync-data batches.
4. The implementation downloads those batches, decrypts with libzproto,
   decompresses Zstd and decodes protobuf, mapping conversations into `zalo.db`.
5. Cmd 591 disposes sync sessions.

This is not an official REST API. It only restores what the phone/service supplies;
deleted/unavailable records and attachment bodies are not guaranteed. The code
depends on Zalo's changing web assets. Its own code and native dependencies need
review before use. The bundled experimental implementation below has not been account-tested.

### Safe separation

The optional CLI also supports writes. Do **not** expose its entire MCP tool set
to an agent that should only read. This package never installs or invokes it.

If choosing that workflow:

1. `zalo-readonly shutdown` to release the account's web connection.
2. Install the reviewed upstream CLI separately, following its installation and
   dependency requirements. Authenticate on the same destination machine, using
   your own account. Do not retrieve credentials from another machine.
3. Use only the explicit phone-history operation:

   ```sh
   zalo-agent sync-mobile --messages-only --wait 300
   ```

   Optionally add `--days 30` to limit the time range. Keep `--messages-only` to
   skip attachments. Do not use `--socket`, which selects server replay instead.
   Do not substitute unrestricted `sync`, which does other stages as well.
4. Confirm the phone's sync request and inspect the actual result/coverage.
   Stop the optional CLI's listener/daemon before resuming this bridge.
5. Import its **local database**, not credentials:

   ```sh
   zalo-readonly import-history '{"db":"/absolute/path/accounts/10000/zalo.db","account_id":"10000"}'
   ```

   IDs are fictional. Use your own account ID and the upstream per-account path.
   The import requires our daemon to be stopped, opens the source DB read-only,
   validates the account-directory name and schema, and deduplicates a transaction
   into our cache. It does not fetch network data or execute upstream code. Only
   text, timestamps and identifiers are copied; raw_data, URLs and files are not.
6. `zalo-readonly resume`, if the saved session still works. Otherwise explicitly
   `login` again. A newer web login can invalidate an older saved session.
7. Verify `coverage` and query an actual message older than the original bridge
   connection. Do not infer success merely from a zero exit code.

Import records are marked `external_history`, not `live`; unmatched sender IDs
get `is_self: null` because phone sync may use opaque IDs. Do not treat them as
new incoming notifications. Database directory names identify the selected account
but are not cryptographic proof of export ownership; only import your own data.


## Coverage and caveats

The cache reports record count, origins and actual oldest/newest timestamps.
It does not know every missed message, so `complete` stays false. Socket errors,
device sleep and offline periods may cause gaps. Deleted or edited messages are
not reconciled in this release; the cache is a record of captured text, not a
perfect mirror of current server state. Retain only data you intend to keep.

References:
- https://github.com/RFS-ADRENO/zca-js/blob/main/src/apis/listen.ts
- https://github.com/PhucMPham/zalo-agent-cli/blob/main/src/commands/mcp.js
- https://github.com/ardennguyen/zalo-agent-cli/blob/99fd7b3964f5b29a954af4108cfd9ae81f86fda8/src/core/sync-v2/index.js
- https://github.com/ardennguyen/zalo-agent-cli/blob/99fd7b3964f5b29a954af4108cfd9ae81f86fda8/src/commands/sync.js

## How data reaches the browser database

The inspected Zalo Web build handles live events and login-time offline queues,
normalizes messages/conversations, then calls its message store's `insertMulti`.
Its storage layer handles encryption at rest. This is separate from later chat
history reads, which decode the stored messages in-page.

The app also exposes a phone-confirmed synchronization route: WebSocket request
590, disposal 591 and wake-up 592, plus an HTTP request path
`/api/transfer-sync-v2/request-sync`. Old code still contains
`/api/message/pull_mobile_msg` and `/api/message/get_crossdb`; their presence alone
does not prove they remain the active protocol. Sync-v2 batches require session
negotiation, decoding/decompression and storage, not just a GET by chat ID.

Evidence: public Zalo Web `1.eddd11e30e151903e701.js` (offline controller,
requestSyncMessage, storage insertMulti) and `web-startup.734c636c89158c74fb14.js`
(sync request handler), inspected 2026-10-25. Public source links are in
WEB-HISTORY.md. No authenticated response dumps are included.
