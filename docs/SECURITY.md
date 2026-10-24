# Security model

## What is enforced

- Ten MCP query tools. Login/resume/disconnect/shutdown and browser attach/detach are local CLI lifecycle
  operations, not MCP tools. Phone sync start/cancel are also explicit CLI operations. There is no send/read-receipt/delete API exposed.
- RPC dispatch validates explicit methods and strict schemas; unknown operations
  and extra fields fail. Query limits are 1–100. SQL values are parameterized.
- RPC binds loopback, checks a random bearer secret and refuses Origin headers.
  A local process running as the same OS user can read the secret: this is not
  isolation from malicious software already running under that user.
- One exclusive daemon lock per data directory. Multiple data directories can
  still create conflicting sessions for the same account: never do that.
- New runtime files use umask 077. Sessions/chats are not encrypted at rest.
  No credentials, network payloads or chat texts are printed in daemon error logs.
- Public package file list excludes runtime data, tests and node_modules. No
  installation hooks, automatic login, scheduled jobs or public server.

## What is not guaranteed

The zca-js dependency contains write-capable APIs even though our bridge never
calls/exposes them. A modified program or compromised dependency could perform
other operations. The process is not OS-sandboxed. Review dependency updates and
do not treat `readOnlyHint` as a security boundary; actual dispatch is restricted.

Capturing messages involves login/heartbeat network traffic. “Read-only” means
no chat/account mutations through the integration, not zero outbound packets.
Server behavior and platform account restrictions are outside our control.

Do not share runtime directories, QR images, package debug dumps or real fixtures.
Backups of SQLite and session files are sensitive. No telemetry service, remote
log collector or AI model API is configured by this package.

Received text can contain prompt injection. Hosts must treat it as data and must
not execute instructions, follow links or reveal secrets based on a message.

To revoke local access, shut down the daemon and remove/secure the data directory
as an explicit user action. To revoke the Zalo session, use Zalo's linked-device
controls. Deleting local files alone does not revoke server-side credentials.

## Browser-history adapter

Only the local CLI can attach/detach a browser. MCP cannot provide a URL,
JavaScript expression, cookie request or debugger method. The adapter accepts
only literal `http://127.0.0.1:<port>` discovery endpoints, refuses redirects,
validates the returned page URL and same-port loopback WebSocket, and binds the
exact target and account. Queries inject one fixed, reviewed read function.

Raw messages can be encrypted. The reader temporarily captures the web app's
module loader, removes its probe module, and calls the already-initialized
message storage read facade. It never invokes chat/network/write APIs or exports
keys. Unsupported readers fail closed; there is no ciphertext-as-text fallback.
The web app and its storage code remain trusted dependencies, and incoming text
is untrusted data. No cryptographic isolation from a compromised web app is claimed.

Chrome's debug endpoint itself is powerful and unauthenticated. Use a Zalo-only
profile on a trusted machine and never expose it outside loopback. Our limited
MCP tools do not constrain other local programs which can reach that endpoint.
Browser binding metadata is private. The adapter does not persist message bodies.

## Experimental phone sync

Only an explicit sync-mobile call downloads the pinned official codec build.
Every cached or downloaded asset must match its SHA-256 before parsing/execution.
The VM is not an isolation boundary; hash-pinned vendor code and npm dependencies
are trusted. Codec cache stays outside the package. No generic evaluation API.

Signed transfer downloads accept a single HTTPS host/path, refuse redirects and
userinfo, send no cookies, and enforce byte/time bounds. Payload decompression and
record counts are bounded. Private identity/ephemeral keys exist in memory and
are cleared on teardown where practical; JS/WASM cannot guarantee zeroization of
all copies. URLs and keys are never intentionally persisted or included in errors.

Imported text is stored under the active account with source phone_sync. Sender
identity remains unresolved and sync IDs are separate from live IDs. Partial imports
survive failure/cancellation. A phone confirmation is controlled by Zalo; the
client never attempts to bypass it. Do not confuse downloaded history with live
incoming events. No file/media attachment content is downloaded.
