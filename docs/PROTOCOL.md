# Protocol notes

The only online engine used here is `zca-js@2.2.0` (MIT):

- `loginQR()` obtains a normal user-confirmed Zalo Web session.
- `login(credentials)` reuses the saved session on explicit `resume`.
- `listener.start({retryOnClose:false})` receives messages and protocol heartbeats.
- `message` contains incoming and own-device mirrored messages (`selfListen:true`).
- `requestOldMessages(type,cursor)` asks cmd 510 (DM) / 511 (group) and emits
  `old_messages`. Bounded attempts happen only after connection.
- Conflict code 3000 is surfaced as `connection_conflict`; no automatic takeover.

API methods for sending messages, typing, receipts, contacts/groups, attachments
and profile mutations are never called by this bridge. Cached history queries
do not open a connection. No raw protocol key/cookie API is exposed.

Phone history `transfer-sync-v2` is researched/documented separately in HISTORY.md,
not implemented by this engine. No claim of a full archive or fixed replay window.
