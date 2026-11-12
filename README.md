# halo

A local desktop assistant powered by Holo4-35B-A3B Q4_K_M, llama.cpp, and Apple Metal.

The interface uses the approved halo brand assets and self-hosted Outfit typography.
See [the brand guide](docs/design/halo-brand-pack/README.md) and [font source](docs/design/halo-brand-pack/FONT-SOURCE.md).
The server accepts text and screenshots through an OpenAI-compatible API.

## Current status

Halo uses React and TypeScript, local Convex, and a TypeScript Cua executor.
Convex stores bots, threads, messages, runs, and explicit saved memory.
The app runtime does not require Python.
The original Python code remains as a regression reference.

Read [the overnight briefing](docs/overnight-briefing-2026-11-12.md) for the latest results, decisions, and remaining limits.
Read [the architecture](docs/convex-architecture.md) for the service boundaries.

## Start Halo

Use Node.js 22.13 or later on an Apple silicon Mac.
Install the project dependencies once:

```sh
bash scripts/poc.sh setup
```

Start the workspace:

```sh
bash scripts/poc.sh
```

Open <http://127.0.0.1:8765>.
The launcher starts local Convex and the TypeScript executor.
It keeps the model and sandboxes off until you request them.
Startup reuses the web build when source files, dependencies, configuration, and output remain unchanged.
Changes or missing assets trigger a rebuild automatically.

Select the model control at the bottom of the sidebar.
Choose **Use model** to load a downloaded model with llama.cpp and Metal.
Use **Unload model** to release its memory.
The app shares one model server across all bots.
Model changes wait until active bot runs finish.

The catalog includes these models and their matching vision projectors:

| Model | Download size | GGUF source |
|---|---:|---|
| Holo4 35B A3B | 22.2 GB | H Company |
| Holo4 27B | 17.8 GB | H Company |
| Holo 3.1 0.8B | 0.88 GB | mradermacher |
| Holo 3.1 4B | 3.74 GB | prithivMLmods |
| Holo 3.1 9B | 6.55 GB | prithivMLmods |

Download sizes include the vision projector. Running a model needs additional memory.
The Holo 3.1 entries use community Q4_K_M conversions with F16 projectors.
They remain marked experimental for desktop workflows.
Their original H Company models and selected conversions use Apache 2.0.
The 35B model uses Apache 2.0.
The 27B model uses CC BY-NC 4.0 and permits non-commercial use.
Each model needs its matching vision projector.
The app downloads pinned files into `models/` and checks their SHA-256 hashes.
The downloaded 35B model remains the default.

If a model already runs from a terminal, Halo uses its local endpoint.
Stop that process in its terminal before switching to app-managed model startup.
The model manager never terminates an unrelated process.
Install llama.cpp with `brew install llama.cpp` if its executable is absent.
The earlier download and model-server scripts below remain available for diagnostics.

## Mac app

Build the native Mac wrapper:

```sh
bash scripts/build-macos.sh
open artifacts/Halo.app
```

The app uses the same React interface in a native WebKit window.
It connects to an existing local Halo workspace or starts the launcher itself.
Quitting stops only services that this app instance starts.
The local build requires this project, its dependencies, and the installed Node.js executable.
If you move the project or change Node.js, rebuild the app.
This is an ad hoc signed local build, not a notarized distribution.

## Bots, threads, and memory

Use the sidebar **+** to create a bot.
Give it a name, then choose an avatar colour and style from the live preview.
Use the **+** beside a bot to create a thread.
Each thread has separate history, sandbox ownership, approvals, and action counts.
Creating a bot or thread does not start a VM.
Replies appear in full when ready. Switching threads or reloading does not cancel generation.
While waiting, the app shows an animated avatar, three dots, and a status label in the bot’s colour.

Select a bot name to edit its name, avatar, instructions, and saved memory.
Saved memory applies only to that bot's threads.
Halo does not extract memories from conversations automatically.
Keep passwords in private login, not in memory or instructions.

Use a thread's edit control to rename or archive it.
Use **Archived** to restore threads and bots.
Stop active runs and sandboxes before archiving their conversations.
The app keeps at least one active bot and one active thread per bot.
The default thread imports the old SQLite transcript once.
The import leaves the original database unchanged.

## Sandbox desktop

Open the desktop drawer with the right-hand control.
Select **Start sandbox** to create a disposable local QEMU Linux VM.
The VM uses four virtual CPUs, 2 GiB RAM, and a 30 GiB disk.
It does not mount host folders or control the Mac desktop.
The default VM has no outbound network access.
Select **Enable web access** before starting a new VM for online browsing.
Downloads remain inside the VM.

Select **Try it** for the practice form.
Desktop mode supplies a fresh screenshot with each model step.
Each action requires approval unless you enable automatic approval for that sandbox.
An approval expires after two minutes and can run only once.
Use the camera button in the desktop header to share a screenshot in chat.
Halo can also capture a screenshot during a desktop task.
Expand the attachment or select **Save PNG** to export it.
Captures remain available after the sandbox stops and the app restarts.
Files stay in `data/screenshots/<thread-id>/` with a limit of 50 captures per thread.
Clearing chat hides old attachments but does not delete their local files.

Action updates appear in an expandable activity trail.
Live status distinguishes planning, execution, approval, and completion checks.
Public search fields remain visible until private values enter the session.
Private login and code fields remain masked.

The sandbox permits 20 action attempts.
A separate assessment checks completion before Halo reports success.
A failed assessment permits at most two further attempts to finish missing work.
An uncertain action RPC is never retried automatically.

Select **Stop & remove sandbox** to delete the current thread's guest.
After an interrupted process, recover recorded guests with:

```sh
bash scripts/poc.sh cleanup
```

Cleanup targets only Halo ownership records under `.cache/cua-poc/`.
It retains downloaded image caches and unrelated VMs.

## Private login

Ask explicitly to sign in before Halo requests a private login form.
The app fills credentials only on the approved HTTPS origin.
Optional named accounts use macOS Keychain, including the original default account.
Select the saved account to reuse or delete.
Verification codes use a separate private form and never enter Keychain or chat.

The JavaScript guest browser masks editable fields, known secrets, and media after credential use.
Closed shadow content blocks private capture.
Passwords and codes do not enter Convex, model requests, or command arguments.
CAPTCHA, push approval, and hardware security keys require a human.
Masking and public-URL filtering do not establish protection against every hostile page or private-network request.
Use demo accounts until you review the live results in the briefing.

## Local boundaries and checks

The executor binds to `127.0.0.1:8765`.
Convex binds to loopback ports 3210 and 3211.
Host, origin, and session-token checks protect local API requests.
The UI uses local fonts and assets.
The launcher keeps existing Convex data across restarts.

Run the runtime tests and TypeScript checks:

```sh
npm test --prefix runtime
npm run check --prefix runtime
npm run build --prefix web
web/node_modules/.bin/tsc --noEmit -p web/convex/tsconfig.json
```

With local Halo running, run the isolated browser checks:

```sh
(cd runtime && node test/check-ui.mjs)
(cd runtime && node test/check-browser.mjs)
```

The browser checks use a fresh Chrome profile and dummy credentials.
The UI check creates and archives a temporary QA bot.
The old Python suite remains available as a regression reference:

```sh
.venv/bin/python -m unittest discover -s tests -q
```

## Install and run

This optional diagnostic setup uses an Apple silicon Mac, Homebrew, and the Hugging Face CLI (`hf`).
The download uses approximately 22.2 GB of disk space.
Model execution also needs memory for the context, image processing, and application buffers.

From this project directory, run:

```sh
bash scripts/setup.sh
bash scripts/serve.sh
```

The setup script installs llama.cpp if the executable is absent.
It downloads the Q4_K_M model and its matching projector into `models/holo4/`.
It pins the model files to repository revision `93400a4`.
An interrupted download can resume with the same command.

The server runs in the foreground. Press Ctrl+C to stop it.
The context contains 8,192 tokens, including the prompt, screenshot tokens, and response.
One server slot keeps the initial memory use predictable.
The launch command requests GPU offload for all model layers.

Open the chat interface at <http://127.0.0.1:8080>.
The API base URL is `http://127.0.0.1:8080/v1`. The model name is `holo4`.

## Text and screenshot tests

After the server reports that it is ready, open another Terminal window.
From this project directory, run:

```sh
python3 scripts/smoke_test.py
```

To send an existing screenshot, run:

```sh
python3 scripts/smoke_test.py --image /absolute/path/to/screenshot.png
```

To capture the main display and send that screenshot, run:

```sh
python3 scripts/smoke_test.py --capture
```

If macOS blocks capture, grant your terminal Screen Recording access in System Settings.
Then restart the terminal application.
The capture command saves the screenshot in `artifacts/`.
The client sends image bytes only to the local server.

Compare the response with the screenshot. Successful image input does not establish accurate UI recognition.
Each successful run saves responses and timing in `artifacts/smoke-*.json`.
The client requires only the Python standard library.

## Model and GPU checks

Inspect the latest file in `logs/` for the Metal device and GPU layer offload.
Also inspect the projector initialization messages and image encoding messages after a screenshot request.
Text inference alone does not establish that the vision projector works.

The main checkpoint is `q4_k_m.gguf` (21.3 GB).
The matching projector is `mmproj.f16.gguf` (899 MB).
F16 is the expected projector format. The main model remains 4-bit.
The server uses both local files explicitly and runs in offline mode.

If llama.cpp reports an unsupported architecture, run `brew upgrade llama.cpp`.
If a response reaches the token limit, repeat the test with `--max-tokens 2048`.
If memory pressure occurs, close other large applications before another attempt.
Actual speed and available memory require measurement on this Mac.

## Remaining work

The current checklist is [TODO.md](TODO.md).
The morning briefing records completed work and the limits of each test.

## Sources

- [Official model card](https://huggingface.co/Hcompany/Holo4-35B-A3B-GGUF)
- [Official model files](https://huggingface.co/Hcompany/Holo4-35B-A3B-GGUF/tree/93400a4)
- [llama.cpp server documentation](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)
- [llama.cpp multimodal documentation](https://github.com/ggml-org/llama.cpp/blob/master/tools/mtmd/README.md)
