# History: server replay vs phone restore

## Built-in replay

The bridge attaches handlers before starting one zca-js listener. Immediately on
connection, it calls `requestOldMessages(0, cursor)` and then type `1`, serially,
for at most five pages each. Responses arrive through `old_messages`; each batch
spans multiple conversations. The next cursor is the last batch entry's actionId,
falling back to msgId. A timeout, empty response or repeated cursor ends that
type. This is best-effort server replay, not unlimited per-conversation history.

The original prototype listened only for `message`, which is why it did not
collect historical batches. That was a script limitation, not evidence that no
history mechanisms exist.

## Older phone-held history (optional, not bundled)

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
review before use. We have not live-tested this flow in the packaged bridge.

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

Direct phone synchronization in this package is intentionally not advertised as
implemented. A future integration should reuse the one live socket, preserve
live capture during restore and retain the explicit phone confirmation step.

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
