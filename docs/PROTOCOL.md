# Protocol notes

The listener engine used here is `zca-js@2.2.0` (MIT):

- `loginQR()` obtains a normal user-confirmed Zalo Web session.
- `login(credentials)` reuses the saved session on explicit `resume`.
- `listener.start({retryOnClose:false})` receives messages and protocol heartbeats.
- `message` contains incoming and own-device mirrored messages (`selfListen:true`).
- The bounded replay adapter asks cmd 510 (DM) / 511 (group) after the cipher
  handshake, using response lastActionId/more for subsequent pages.
- Conflict code 3000 is surfaced as `connection_conflict`; no automatic takeover.

API methods for sending messages, typing, receipts, contacts/groups, attachments
and profile mutations are never called by this bridge. Cached history queries
do not open a connection. No raw protocol key/cookie API is exposed.

Phone history `transfer-sync-v2` has an explicit experimental CLI entry point
in v0.3.0; see HISTORY.md. It is not triggered by login or MCP queries. No claim of a full archive or fixed replay window.

Version 0.2.0 also supports an explicitly attached browser history source.
It uses fixed CDP Runtime.evaluate calls to query the web app's existing local
message storage/decryption facade. This is not a generic debugger or a new Zalo
HTTP history endpoint. See WEB-HISTORY.md for source evidence and coverage.
