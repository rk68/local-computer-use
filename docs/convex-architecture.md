# Local Convex backend

Halo uses Convex 1.49.0, Convex Agent 0.7.9, AI SDK 7.0.169, and React 19.
The Agent package supports these installed versions through its declared peer dependencies.
No cloud inference provider or Convex AI Gateway is configured.

## Domains

- Bots own their names and instructions. Threads belong to bots.
- Conversations own persistent Agent thread IDs, messages, pagination, and streaming deltas.
- Runs own queued work, status, cancellation, and error recovery.
- Sandboxes own Cua guest handles, screenshots, proposals, private login, and ownership files.

Convex is the source of truth for conversation history and runs.
Python remains the local Cua executor. It does not save new thread messages to SQLite.
The legacy SQLite file remains available for migration and recovery.

The browser sends an application thread ID with each mutation.
The backend maps that ID to the Agent component thread ID.
Each sandbox request carries the application thread ID in `X-Halo-Thread`.
Each Python `Desk` has its own lock, guest, pending approval, browser, and ownership file.
Stopping one thread does not stop another thread.

## Streaming and memory

Text generation uses Convex Agent with the AI SDK OpenAI-compatible provider.
The provider connects to `http://127.0.0.1:8080/v1` and disables Holo4 thinking output.
Streaming deltas are saved in Convex and delivered through subscriptions.
Closing the page or switching threads does not cancel the backend action.
The Stop button cancels the run and aborts its stream.
A timeout clears an interrupted text run so the thread can accept another message.

The UI uses `useUIMessages` from Convex Agent. It does not maintain a second `useChat` history.
History loads in pages of 40 messages. The model receives recent context, rather than the entire database.
Bot instructions persist across threads. Cross-thread search, embeddings, and automatic long-term memory are not configured.

Desktop runs use the existing screenshot and action loop in Python.
Convex schedules the command once and monitors the local executor.
Assistant replies and execution notices enter the thread history.
An uncertain command is not retried automatically.
The migration does not change the existing guest action limits or approval checks.

## Local deployment and access

Run `bash scripts/poc.sh` after installing dependencies with `bash scripts/poc.sh setup`.
The launcher starts anonymous local Convex on port 3210 and Halo on port 8765.
It refuses cloud deployment configuration and occupied project ports.
A process-scoped CLI preload adds the backend’s loopback interface flag and disables its telemetry beacon.
The preload targets only `convex-local-backend`; it does not change installed packages or system settings.
It does not start llama.cpp or a VM.
Stop the launcher with Ctrl+C. It stops its own processes and requests guest cleanup.

Convex local development is a development environment, not a production deployment.
The CLI stores deployment configuration in ignored files under `web/` and its local state directory.
Keep that state when restarting. Do not delete local deployment data to restart the app.
For a production distribution, use a managed self-hosted backend and a separate authentication design.

A random local session token is stored at `.cache/halo/session-token`, with file permissions set to 0600.
The launcher supplies it to Convex and Python. All exposed application queries and mutations require it.
Only trusted loopback browser requests can obtain it from the Python session endpoint.
The app does not expose an unauthenticated mutation that starts a VM.
This is a single-user local session, not multi-user account authentication.

Passwords stay in the private Python login path and macOS Keychain.
They are not placed in Convex run arguments, messages, or file storage.
Screenshots remain in the local executor; the app does not upload each screenshot to Convex.
Bots share the user's origin-scoped Keychain vault. Separate accounts per bot are not implemented.

## Migration and recovery

On the first browser connection, Halo imports the old completed chat into the default thread.
The import is idempotent and does not delete or change the SQLite source file.
New bots and threads do not import that history.

Thread ownership files are stored in `.cache/cua-poc/threads/<thread-id>.json`.
If the executor restarts with an ownership record, use Stop in that thread before starting another guest.
`bash scripts/poc.sh cleanup` also checks recorded thread ownership files.
Cleanup only targets the uniquely named guests in those records.

## Checks and limits

Run the Python unit suite, frontend build, and Convex type check:

```sh
.venv/bin/python -m unittest discover -s tests -q
npm run build --prefix web
(cd web && npx tsc --noEmit -p convex/tsconfig.json)
```

With Halo running, run the integration check:

```sh
.cache/browser-check-env/bin/python scripts/check_convex.py
```

That check uses real local Convex, a temporary fake model, and an isolated Chrome profile.
It creates a test bot, checks history and streaming, then archives that bot and restores the model URL.
It does not start Holo4 or a VM. Do not run it while using the app for a real model request.
The screenshot/tool adapter check confirms serialization and Zod parsing against the fixture.
It does not prove inference quality or tool compatibility with the actual Holo4 checkpoint.
A live Holo4 and multi-VM regression remains a separate check.

The separate `scripts/check_desktop_bridge.py` harness requires local Convex running and port 8765 free.
It binds a temporary executor with fake Cua guests and uses temporary ownership files.
Do not run that harness alongside the normal Halo launcher.

On 11 November 2026, checks passed for 69 unit cases, the frontend build, and Convex TypeScript.
The real Convex integration passed history, isolated context, streaming, reload, switching, cancellation, and access checks.
The desktop bridge passed two fake guests, independent approvals, action counts, transcript updates, and stopping one guest.
The browser fixture suite passed private forms, secret masking, laptop layouts, and mobile width.
The launcher was restarted with the same Convex data; ports 3210, 3211, and 8765 listened only on 127.0.0.1.
Holo4 and real VMs were not started during these checks.
