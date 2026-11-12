# Local Convex and TypeScript runtime

Halo uses Convex 1.49.0, Convex Agent 0.7.9, AI SDK 7.0.169, and React 19.
The desktop executor uses `@trycua/cua` 0.21.0 in Node.js.
The web app and executor use Zod 4.6.7.

## Domains

- Bots own their names, instructions, and explicit saved memory.
- Threads own history, run status, and an independent sandbox.
- Convex Agent owns message storage and pagination.
- The TypeScript executor owns guest handles, screenshots, approvals, and private login.
- macOS Keychain owns default and named website accounts.

Convex is the source of truth for messages and runs.
The executor keeps temporary working state for each desktop thread.
It does not write new chat history to SQLite.
The original database remains a read-only migration source.

The browser sends an application thread ID to Convex.
Convex maps that ID to the Agent component thread ID.
Desktop requests carry the application ID in `X-Halo-Thread`.
Each `Desk` has a separate lock, guest handle, approval, and ownership file.
Stopping one thread does not stop another thread.

## Text replies and memory

Convex Agent calls the local OpenAI-compatible endpoint through AI SDK.
The default model URL is `http://127.0.0.1:8080/v1`.
Holo thinking output is disabled.
Text generation uses a non-streaming model request.
A transaction saves the complete reply only while its run remains active.
Cancelled or obsolete runs cannot publish a late reply.
The UI subscribes to saved messages and shows an animated status while waiting.
Switching threads or reloading does not cancel generation.
The Stop control cancels the active text run.
Timeout recovery clears interrupted runs.

The UI uses `useUIMessages` rather than a second `useChat` history.
History loads in pages of 40 messages.
Inference receives bounded recent context within the 8K model window.
Bot instructions and explicit saved memory persist across its threads.
Saved memory is editable and limited to 2,000 characters per bot.
The app does not extract memory automatically or search other bots' threads.
Embeddings and automatic cross-thread retrieval remain unconfigured.

## Model lifecycle

The local executor serves the supported model catalog through authenticated endpoints.
The catalog pins model revisions, file sizes, and SHA-256 hashes.
Downloads use Node streams and resumable partial files.
A download becomes an installed model only after its checksum passes.
Existing model files remain in their original directory.

The app starts `llama-server` with fixed arguments and loopback binding.
It uses one server slot and one model at a time.
The model manager tracks its own child process.
It never terminates an externally started model server.

Convex stores a model-change guard.
The guard checks active runs in the same transaction that claims a model change.
New model runs wait while the model loads or unloads.
The executor clears a stale guard after restart.
The app does not load a model merely because a thread or workspace opens.

## Desktop execution

Convex schedules each desktop command once and monitors the local executor.
Replies and execution notices enter the persistent thread history.
The executor retains screenshot grounding and single-use approvals.
Approvals expire after two minutes.
Each sandbox permits 20 action attempts.
An uncertain action command is never retried automatically.

A separate model assessment checks completion against the latest screenshot and executed steps.
An incomplete assessment permits at most two attempts to finish missing work.
Malformed assessments and exhausted attempts pause the task.
Repeated actions with unchanged screenshots also pause the task.

The Node SDK explicitly creates local QEMU VMs with networking disabled by default.
The adapter converts screenshot coordinates and the SDK's scroll convention.
After a resize, it reconnects to the persisted guest endpoint.
Read-only health probes wait up to two minutes for the guest agent.
No host desktop input API is part of this path.

Online browsing uses a fixed JavaScript helper inside the guest.
The helper installs pinned `playwright-core` and drives guest Chromium.
Node.js, npm, Chromium, and outbound access are required inside an online guest.
The helper does not drive the host browser.

## Private login

Login requires an explicit user request and an exact HTTPS origin.
Credential bodies use the private local endpoint, outside Convex and chat.
The guest receives short-lived request files in private tmpfs.
Browser operation errors omit submitted values.
Known secrets, editable fields, and media are masked before model capture.
Closed shadow content blocks the private view.

The vault uses the native macOS Keychain through `@napi-rs/keyring`.
The original default-account service remains compatible.
Named accounts use separate origin-and-label keys.
The account-label index also stays in Keychain.
Deleting one account leaves other accounts unchanged.
Verification codes use a private form and never enter Keychain.
CAPTCHA, push approvals, and hardware security keys require a human.

Rendered masks and public-URL checks do not prove protection against every hostile page.
The URL filter is not a VM firewall.
Use the recorded live results to assess the current prototype limits.

## Local deployment and access

Install dependencies with `bash scripts/poc.sh setup`.
Start the app with `bash scripts/poc.sh`.
The launcher starts local Convex and the TypeScript executor.
The normal application path does not require Python.

Convex ports 3210 and 3211 bind to loopback.
The executor binds to `127.0.0.1:8765`.
The CLI preload adds the local backend's interface flag and disables its telemetry beacon.
The preload does not edit installed packages.
The launcher refuses cloud deployment configuration and occupied project ports.
It retains the existing local deployment data.

The random session token stays in `.cache/halo/session-token` with mode 0600.
Application queries and mutations require that token.
The executor checks Host, Origin, fetch-site, request size, and content type.
This is a single-user local development environment.
It is not a multi-user production authentication design.

## Migration and cleanup

The first browser connection imports completed legacy chat into the default thread.
The import is idempotent and leaves SQLite unchanged.
Node's read-only SQLite reader exists only for that recovery path.

Thread ownership files use `.cache/cua-poc/threads/<thread-id>.json`.
A recorded guest after restart requires Stop before another guest can start.
`bash scripts/poc.sh cleanup` recovers only recorded Halo guests.
Invalid ownership names fail closed.
Failed cleanup retains the record for another attempt.
Downloaded images remain cached.

The original Python executor and its tests remain as a regression reference.
They are not part of the default launcher.

## Mac wrapper

`desktop/macos/Halo.swift` hosts the same UI in `WKWebView`.
The local build connects to the project runtime or starts it through Node.
The wrapper stops only a launcher that it starts.
It does not add a privileged JavaScript bridge or host computer controls.
The build requires the project path and local Node installation to remain available.
The result is locally signed and is not notarized for distribution.

## Checks

```sh
npm test --prefix runtime
npm run check --prefix runtime
npm run build --prefix web
web/node_modules/.bin/tsc --noEmit -p web/convex/tsconfig.json
```

With local Convex and the executor running:

```sh
(cd runtime && node test/check-ui.mjs)
(cd runtime && node test/check-browser.mjs)
(cd runtime && node --import tsx test/check-keychain.ts)
```

With local Convex running and the normal executor stopped:

```sh
(cd runtime && node --import tsx test/check-bridge.ts)
```

The bridge check starts fake guests, not real VMs.
The separate live harnesses start real disposable VMs and require available memory.
The latest evidence and remaining limits are in `overnight-briefing-2026-11-12.md`.

## Shared screenshots

The TypeScript executor captures the guest view through the existing masking path.
It stores PNG files in a private local directory for each thread.
The executor returns attachment metadata with its transcript.
The Convex monitor saves the caption, image ID, capture time, and message association.
PNG bytes stay on the Mac.

The browser fetches each image with the session token and thread header.
The file endpoint rejects another thread's image ID.
Image IDs contain random hexadecimal bytes and cannot contain paths.
The chat SDK can combine assistant messages.
The UI binds those attachments by message ID or by message order and exact caption.

A screenshot-sharing tool continues the same task after capture.
The completion check requires a selected visual result for image-selection tasks.
A search results grid alone cannot establish completion.
The backend also attaches the final screenshot after a verified visual task.
