# Release checklist

1. Keep version in package.json, bin.mjs, mcp.mjs and installation docs consistent.
2. Run `npm ci --ignore-scripts`, `npm test`, `npm audit --omit=dev`.
3. Inspect `git ls-files` and `npm pack --dry-run --json`. Never include runtime
   state, credentials, QR images, real messages or actual personal identifiers.
4. Install the packed tarball into a disposable user-owned prefix and run help,
   version and config; these must not log in or start a listener.
5. Push an annotated release tag only after checks pass. Verify a clean install
   from the public HTTPS Git tag. No npm registry publication is required.
6. Report offline test coverage separately from live account validation. Do not
   start a live session merely to release: it could evict a user's active agent.

## 0.1.0

First packaged read-only release. QR login/resume, shared local daemon, SQLite
cache, six MCP tools, CLI queries, bounded server history replay and optional
external phone-history SQLite import. No chat mutations or automatic reconnect.
Windows, full phone sync, edit/delete reconciliation and automatic notifications
are not implemented. Linux is covered by CI; macOS by local offline tests.

## 0.2.0

Add explicit browser attachment and three read-only MCP tools for decoded,
per-conversation existing Zalo Web history. Account/target binding, bounded
queries, compound pagination and safe failure on unknown web readers. Preserve
legacy listener-cache tools. Live reader and synthetic CDP tests are documented
separately in WEB-HISTORY.md. No private browser artifacts are distributed.

## 0.3.0

Experimental explicit phone-sync CLI, background progress/cancel, existing-socket
590/601 transfer and 591 cleanup, pinned official codecs, bounded text-only
SQLite import, and read-only MCP sync status. No account test for this native
flow. Opaque sync thread IDs remain separate from live IDs; identity mapping,
attachments and full archives are unsupported. Correct offline replay cursors.
Requires Node 22.16+ for Zstd. No proprietary codecs or private data bundled.
