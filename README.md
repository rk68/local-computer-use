# halo

A local desktop assistant powered by Holo4-35B-A3B Q4_K_M, llama.cpp, and Apple Metal.

The interface uses the approved halo brand assets and self-hosted Outfit typography.
See [the brand guide](docs/design/halo-brand-pack/README.md) and [font source](docs/design/halo-brand-pack/FONT-SOURCE.md).
The server accepts text and screenshots through an OpenAI-compatible API.

## Current status

The app passed a live Chrome test with Holo4 and the Cua Linux VM.
The test verified text chat, screenshot questions, an approved click, and approved text entry.
Offline practice remains the default. Online browser mode and private login are experimental additions.
Live checks passed for online startup, private login, Keychain reuse, downloads, and an eight-action task.
See [validation results](docs/live-validation-2026-11-11.md). See [online browser setup](docs/online-browser.md) and [isolated browser checks](docs/browser-checks.md).

## Chat and sandbox POC

Keep the Holo4 server running on port 8080.
Use Node.js 22.12 or later for the web build.
From this project directory, install the web and Cua dependencies:

```sh
bash scripts/poc.sh setup
```

Then run the app:

```sh
bash scripts/poc.sh
```

Open <http://127.0.0.1:8765> in your browser.
Chat works without a sandbox. The app sends messages to your existing local Holo4 endpoint.
SQLite saves the last 60 text chat messages in `data/chat.sqlite3`.
Halo receives up to six recent text turns as context. The app restores those turns after a restart.
Desktop context belongs to the current VM session.
**Clear chat** removes the saved transcript and the current conversation context.

The web app uses React, TypeScript, Vite, Zod, and Vercel AI SDK UI.
AI SDK UI handles chat state and incremental text delivery.
Text replies stream from llama.cpp as it generates them. **Stop generating** interrupts the active text request.
Only completed text turns enter saved memory. Desktop proposals appear after the full action passes validation.
The Python API owns the sandbox and calls the local llama.cpp model endpoint.

The conversation domain owns messages and memory. See `web/src/conversation/` and `app/chat_memory.py`.
The sandbox domain owns the guest action contract. See `web/src/sandbox/` and `app/sandbox_actions.py`.
The playground coordinates the two domains. The Python API validates actions and consumes approvals.

To try computer use:

1. Click **Start sandbox**. The first run downloads the Linux image and can take several minutes.
2. Wait for the guest screenshot. The app selects desktop mode when the sandbox starts.
3. Click **Try it** to prepare the practice task.
4. Send the message.
5. Inspect the proposed action and click **Approve one action** or **Reject**.
6. Inspect each new screenshot. Halo continues the same task and proposes the next action.
7. Click **Stop & remove sandbox** after the experiment.

The app creates a local QEMU VM with 4 virtual CPUs, 2 GiB RAM, and a 30 GB virtual disk.
The app sets Cua's host memory reserve to 4 GiB unless you supply `CUA_VM_MIN_AVAILABLE_MB`.
The guest network is disabled by default. Select **Enable web access** before starting a new VM for online browser mode.
The app does not mount host folders or connect to an existing desktop.
It does not install a host input driver, register the Mac for remote access, or call a cloud model.
The model can propose clicks, text entry, field replacement, selected keys, and scrolling.
An approved field replacement selects the current value and types the new value.
A fixed setup command opens the practice form inside the guest.
Offline prompts restrict work to the form. Online mode uses browser controls inside the same VM boundary.

By default, each action needs approval and expires after two minutes.
Select **Approve all actions for me** to execute validated actions automatically in the current sandbox.
You can enable it while an action awaits approval. Clear the checkbox to pause before the next action.
Halo inspects a fresh screenshot after each action and continues through the parts of your request.
For example: “Change the name to Alice and set the short note to Hello from Halo.”
Each sandbox permits 20 action attempts, including automatically approved actions.
Automatic approval resets when you stop the sandbox.
A separate assessment checks the screenshot, executed steps, and sandbox state. Repeated actions pause when the screen stops progressing.
Stop discards pending proposals and removes the guest. An input event already sent cannot be undone.
Ctrl+C also attempts guest cleanup. Closing the browser tab does not stop the server.

After an interrupted server process, remove the recorded POC guest with:

```sh
bash scripts/poc.sh cleanup
```

Cleanup targets only the uniquely named guest in `.cache/cua-poc/owned-sandbox.json`.
It retains downloaded image caches. It does not delete other VMs or change your Holo4 model files.
If cleanup fails, the app retains its ownership record for another attempt.

The Python environment is `.venv/`. Cua state uses `.cache/cua-poc/`.
The app disables Cua telemetry through environment variables and the sandbox creation argument.
It binds only to `127.0.0.1:8765` and blocks cross-origin API requests.
The UI loads no external scripts, fonts, or analytics.

If the SDK reports a missing runtime, inspect the local runtime setup from this project directory:

```sh
CUA_HOME="$PWD/.cache/cua-poc" CUA_TELEMETRY=0 .venv/bin/cua runtime doctor
CUA_HOME="$PWD/.cache/cua-poc" CUA_TELEMETRY=0 .venv/bin/cua runtime setup --dry-run
```

The app fails if QEMU or network isolation is unavailable. It does not select a weaker runtime automatically.
Full integration requires the Cua package, a compatible Linux image, and a working local runtime.
The QEMU runtime requires `qemu-system-aarch64` and `qemu-img` on the app process PATH.
If QEMU is absent, run `brew install qemu` in your Mac Terminal.
Then restart the app so it loads the current code and environment.
The pinned Cua packages use a project-local compatibility adapter for the renamed account configuration argument.
The adapter keeps account access disabled and does not edit installed packages.
Application events and error tracebacks go to `logs/poc.log`, with bounded rotation.
The app does not log chat text or screenshots.
The image resolves its architecture and digest at creation. The POC does not pin an image digest yet.
Holo4 tool calling and coordinate accuracy also need a live trial.

Run the boundary and lifecycle tests with:

```sh
python3 -m unittest discover -s tests -v
```

These tests use fake guests. They do not establish successful VM boot or browser operation.

## Install and run

Requirements: an Apple Silicon Mac, Homebrew, Python 3, and the Hugging Face CLI (`hf`).
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

## Next steps

- Install llama.cpp and download both files.
- Establish Metal offload and text inference.
- Establish image input and inspect screenshot accuracy.
- Connect Holo Desktop CLI to the local endpoint.
- Add the computer-control loop.
- Experiment with multiple agents that share the server.

## Sources

- [Official model card](https://huggingface.co/Hcompany/Holo4-35B-A3B-GGUF)
- [Official model files](https://huggingface.co/Hcompany/Holo4-35B-A3B-GGUF/tree/93400a4)
- [llama.cpp server documentation](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)
- [llama.cpp multimodal documentation](https://github.com/ggml-org/llama.cpp/blob/master/tools/mtmd/README.md)
