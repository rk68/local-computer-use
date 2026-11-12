# Halo morning briefing — 12 November 2026

The TypeScript/Convex migration and UI changes are implemented.
The browser app and the native Mac app are ready for your review.
The model and all test VMs are off.
This file records the work, decisions, evidence, and remaining limits.

## Open the application

- Browser: <http://127.0.0.1:8765>
- Mac app: `artifacts/Halo.app`
- Local Mac app archive: `artifacts/Halo-macOS-local.zip`
- Current checklist: `TODO.md`
- Review screenshots: `artifacts/overnight/`

To open the Mac app:

```sh
open artifacts/Halo.app
```

The local build uses this project and the installed Node.js executable.
Keep the project in place.
It is locally signed, not notarized for redistribution.

## What changed

### TypeScript and Convex

The default launcher now uses Node.js for the executor and service lifecycle.
The Cua adapter uses `@trycua/cua` 0.21.0.
The guest browser helper uses JavaScript and pinned `playwright-core`.
The normal app path does not require Python.
The original Python code and tests remain as a regression reference.

Convex remains the source of truth for bots, threads, messages, and runs.
Existing Convex data and the SQLite recovery transcript remain intact.
The SQLite import uses a read-only Node reader.
Per-thread guest ownership, approvals, action limits, and cleanup records remain separate.

A completion assessment checks the screenshot and executed-step trail.
An incomplete assessment can send missing-result feedback back to the agent twice.
It cannot retry an uncertain action RPC.
Exhausted assessments still pause the task.

### Models in the application

The sidebar footer opens a model picker.
**Use model** starts llama.cpp with Metal from inside Halo.
**Unload model** stops only the model process that Halo starts.
The app shares one model server across all bots.
A Convex guard prevents new runs during a model change.

The catalog contains two official Holo4 Q4_K_M releases:

| Model | Weight files | License | Current local files |
|---|---|---|---|
| Holo4-35B-A3B | About 22.2 GB, including projector | Apache 2.0 | Already downloaded |
| Holo4-27B | About 17.8 GB, including projector | CC BY-NC 4.0 | Not downloaded overnight |

Sources: [35B model card](https://huggingface.co/Hcompany/Holo4-35B-A3B-GGUF), [27B model card](https://huggingface.co/Hcompany/Holo4-27B-GGUF).

Downloads use pinned revisions, resumable partial files, and SHA-256 checks.
The second model remains an explicit download choice.
This avoids an unsolicited 17.8 GB download and preserves the current default.
The catalog does not list BF16, FP8, or NVFP4 files as interchangeable llama.cpp models.

An earlier `scripts/serve.sh` model server was already running when I inspected the app.
Halo correctly recognized it as an external model.
The runtime never silently kills an external process to claim port 8080.
I stopped that verified project server for the lifecycle check.
The app then loaded the existing weights, streamed a reply through Convex, and unloaded the model successfully.

### UI and avatars

The chat/desktop divider now extends to the viewport bottom.
An older `align-self: start` rule caused the short divider.
Desktop buttons now use consistent stroke icons, spacing, and alignment.
The stop control stays at the bottom of the drawer.
The desktop remains available only from the right-hand drawer.

Halo avatars now have pearl shading, highlights, shadows, and perspective movement.
Their faces follow a nearby pointer.
One shared pointer listener updates CSS without React renders on each movement.
Reduced-motion and touch layouts retain a static presentation.
This uses SVG and CSS depth, not a WebGL mesh or copied Grok artwork.

### Threads and saved memory

Threads now have rename, archive, and restore controls.
Archived bots also have restore controls.
The backend prevents archiving a thread with an active run or sandbox.
Each bot retains at least one active thread.
The workspace retains at least one active bot.

Bot settings now include explicit saved memory.
The memory persists in Convex and applies only to that bot's threads.
It reaches both text and desktop inference.
The app does not extract memories automatically.
It does not search another bot's history or start an embedding service.

### Private login and verification codes

Credentials remain outside chat and Convex.
The native macOS vault supports default and named accounts on each exact HTTPS origin.
The original default-account Keychain entries remain compatible.
The account-label index also stays in Keychain.
Deleting a selected account leaves other accounts intact.

Verification codes now use a private form.
The guest fills only one unambiguous code field on the approved origin.
Codes are masked and never saved in Keychain.
The ordinary model typing path refuses password and verification-code fields.

The rendered privacy test caught a porting error in regular-expression matching.
A global JavaScript regular expression could skip reflected values between DOM nodes.
The mask locator now uses a stateless expression.
Rendered checks passed after the correction.

CAPTCHA, push approvals, and hardware security keys pause for a human.
No unattended CAPTCHA solver or real-account authentication was attempted.

### Mac application

I inspected the installed Grok Bot app's framework directory.
It contains `Electron Framework.framework` and `app.asar`.
Its bundle identifier is `com.anysphere.sand`, with installed version 0.79.4.
This establishes the installed app's Electron shell without inspecting account data.

Halo's first Mac version uses Swift/AppKit and `WKWebView`.
It reuses the React UI and the TypeScript/Convex services.
This avoids another bundled Chromium process beside the local VLM.
The local app bundle is about 360 KB, excluding the existing project and dependencies.

The wrapper connects to an existing Halo workspace or starts the launcher itself.
It checks the local project token before accepting an existing workspace.
It stops only a launcher that it starts.
It does not add a privileged JavaScript bridge or host desktop controls.

## Subscription and computer-use exploration

### ChatGPT and Codex

An eligible ChatGPT plan can power an open-source local app through the documented Sign in with ChatGPT flow.
The user must grant plan-usage permission.
The app must register correctly, protect tokens, and respect account-specific model availability.
[OpenAI's integration guide](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt) explains that path.

The preview flow currently excludes native computer use.
It supports eligible custom/function tools and image inputs, subject to the selected model.
A future Halo adapter can therefore expose our guest controls as custom tools.
It cannot assume access to the built-in ChatGPT computer-use tool through that subscription route.
[Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations) establish this distinction.

I left subscription sign-in as exploration.
It requires your interactive consent and a separate provider/tool adapter.
I did not copy tokens from either Codex account or spend subscription/API allowance on experiments.
The existing conversation recovery used local session records, not authentication credentials.

### Claude

Claude exposes screenshot, mouse, and keyboard computer use through its API toolset.
That tool protocol differs from Holo's function calls.
The same guest executor can support it after a provider adapter is implemented.
[Claude computer-use documentation](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool) describes that loop.

Anthropic distinguishes hosting its unmodified Claude Code binary from offering Claude.ai sign-in in a third-party app.
The latter is not a permitted general proxy for subscription credentials.
Its guidance directs third-party application integrations toward API keys or supported providers.
[Authentication and credential guidance](https://code.claude.com/docs/en/legal-and-compliance) covers these boundaries.

Decision: keep remote providers out of the local model picker for this iteration.
A future integration needs explicit remote-data controls, its own authentication flow, and protocol tests.
This does not require a separate downloadable VLM to be installed locally.

## Evidence so far

| Check | Result |
|---|---|
| TypeScript runtime tests | 33 passed, including chat-context, screenshot, model registry, and startup-cache regressions |
| Runtime, frontend, Convex TypeScript checks | Passed |
| Frontend production build | Passed |
| Original Python regression suite | 69 passed |
| Real Convex → TypeScript → two fake guests | Passed |
| Real Convex bot/memory and thread controls | Passed in isolated Chrome |
| Three laptop sizes, mobile, light/dark | Passed, with screenshots |
| Full-height divider and pointer gaze | Passed |
| Native Mac window → React/Convex workspace | Passed |
| Native Keychain default/named dummy accounts | Save/read/scope/delete passed |
| Rendered secret, media, shadow, and code masks | Passed on controlled dummy pages |
| Two real offline QEMU VMs | Started with distinct identities |
| Stop one real VM, preserve the other | Passed |
| Longer real-Holo4 offline practice task | Passed in six actions, including independent completion assessment |
| Real online guest and public dummy login | Filled, saved, reused, and deleted a named demo account successfully |
| Actual-guest adversarial rendering fixture | Pixel checks passed across five captures with 5ms text changes, reflected secrets, canvas, and closed-shadow rejection |
| Managed model cold start and unload | Passed through the real UI, including real Holo4 inference through Convex |
| Native Mac cold start and owned-service cleanup | Passed. The app started Convex and Node, loaded the workspace, then stopped its services on quit |
| Durable history and streaming regression | Passed reload, thread switching, context isolation, cancellation, authentication, and mobile drawer checks with a fake model |

The first longer practice run filled the fields but omitted Save.
The checker rejected the completion claim.
The port also exposed the SDK's opposite scroll-delta convention.
After the correction and better step evidence, the full task passed.

Online startup exposed a readiness distinction.
The SDK timeout bounds one guest-agent probe rather than a retry budget.
The adapter now retries only read-only readiness probes during the two-minute startup window.

Online navigation also exposed DNS64 handling.
The VM gateway returns translated public IPv4 addresses under `64:ff9b::/96`.
The filter now classifies the embedded IPv4 destination.
Translated private and loopback destinations still fail closed.

The cold-start check also exposed stale sandbox metadata after the executor restart.
Startup now reconciles thread status with actual guest ownership records.
It marks interrupted desktop runs as failed rather than resubmitting them.
A regression test covers both idle threads and recorded guests that need cleanup.

The first native quit handler waited on a MainActor task after AppKit suspended it.
The corrected handler waits for the launcher's bounded cleanup before it exits.
The executor also exits explicitly after cleanup so native workers cannot hold the closed app open.
A second cold-start check passed, with all owned service ports closed afterward.

## Final local state

- The native Mac app is open with local Convex and the TypeScript executor.
- Port 8080 has no model server after the UI unload check.
- No Halo test guest or pending approval remains.
- Temporary QA bots are archived.
- Dummy Keychain entries from this session are deleted.
- The fake-model regression restored the normal local Holo4 URL.
- Changes remain local for your review. No release or Slack announcement was made.
- The pre-existing untracked `docs/design/brand/` directory remains untouched.

## Questions resolved without interrupting you

| Question | Decision and reason |
|---|---|
| Keep Python as a production fallback? | Keep its source for regression checks. Use TypeScript in the normal launcher. |
| Run models when the app opens? | Keep them off until a model choice. Selecting **Use model** performs startup in the app. |
| Load different models per bot? | Share one model process to fit the Mac's memory. Threads still have separate context and guests. |
| Download the second model overnight? | Leave it as an explicit choice. The installed 35B model supports the current regression. |
| Build a full renderer for the avatars? | Use shaded vector art and CSS perspective. This avoids a GPU renderer beside the local VLM. |
| Match Grok's desktop framework? | Confirm Electron, then use a smaller native wrapper for this Mac prototype. |
| Automatically infer long-term memory? | Keep user-edited memory. Avoid hidden cross-thread recall and accidental secret retention. |
| Add cloud model access immediately? | Document the supported paths. Defer implementation until interactive consent and remote-data controls are available. |
| Test credentials with your accounts? | Use synthetic credentials and the documented public demo only. |
| Handle CAPTCHA unattended? | Pause for a human. Do not bypass it. |
| Publish or announce anything? | No deployment, release, PR announcement, or Slack message. |

## Remaining limits

- The Mac build is tied to this checkout and local Node installation.
- The second model's inference and download were not tested with full-size weights.
- Remote provider sign-in and computer-use adapters remain exploration.
- Verification-code checks use controlled fixtures, not a real MFA account.
- CAPTCHA, push approval, and hardware keys need an interactive user.
- Automatic memory extraction, embeddings, and cross-thread retrieval remain unconfigured.
- Browser masking does not establish protection against every hostile rendering or timing technique.
- URL filtering does not guarantee private-network isolation.

## Follow-up: sessions, progress, and shared screenshots

This section covers the additional requests after the first briefing.

### Sessions and memory

Multiple threads have persistent history, separate guest ownership, separate approvals, and independent run status.
Multiple bots also have separate instructions and saved memory.
Explicit saved memory applies across the threads of one bot.
The app does not extract memory automatically or retrieve another thread's history.
One local model process serves these threads with one inference slot.
This supports multiple sessions, but it does not imply simultaneous GPU inference.

I deferred several bots collaborating in one thread.
That feature needs participant roles, turn order, memory scope, and one owner for guest actions.
Concurrent bots must not click the same desktop independently.
This decision keeps the current per-thread isolation intact.

### Search fields and private views

The black bar came from masking every input before taking a browser screenshot.
That rule also hid public search fields from Halo.
The browser now leaves ordinary search fields visible before private data enters the session.
Passwords, login fields, email fields, and verification-code fields remain masked.
After private login or code entry, all editable fields remain masked.
Known reflected values and media retain the existing protection.
Rendered checks cover both public search visibility and private-value masking.

A screenshot failure now has a separate error message.
It explains that the action can have completed and asks for a refresh.
The runtime does not repeat an uncertain action automatically.

### Activity and image results

Chat now groups consecutive action updates into an expandable activity trail.
The complete action trail remains available.
Status indicators distinguish thinking, execution, approval, and completion checks.
Active status includes elapsed time.
Reduced-motion settings disable the status animations.

Halo has a screenshot-sharing tool and a manual camera button in the desktop header.
Captures appear in chat with expansion and PNG export.
PNG files persist under `data/screenshots/<thread-id>/` with private filesystem permissions.
Convex stores their message association, caption, and capture time.
The image endpoint requires the local session token and the matching thread ID.
Screenshots survive application restarts and guest removal.
Each thread can retain 50 captures.
Clearing chat hides captures from that history but does not delete their local files.
Retention and deletion controls remain on the TODO list.

For image-selection tasks, Halo must select a matching result or open its larger preview.
A search results grid alone does not establish completion.
The independent completion check now applies that rule.
A verified visual result also receives a screenshot attachment if Halo did not share one explicitly.
This improves the workflow without guaranteeing that every website or model action succeeds.

### Follow-up evidence

The runtime checks passed after adding screenshot persistence, thread separation, authentication, and visual-completion regressions.
The rendered browser check passed for visible search fields and private masking.
The real Convex bridge check passed with isolated fake guests.
It covered screenshot persistence, reload, expansion, PNG download, activity grouping, and timed completion status.
Desktop, mobile, and both themes passed without browser errors.

The live Google attempt reached a CAPTCHA and paused without a completion claim.
No CAPTCHA bypass was attempted.

The live Wikimedia Commons task passed with the real local Holo4 model and an online guest.
Halo selected an orange tabby, opened its larger preview, and shared a screenshot in three actions.
The independent completion check accepted the visible selection.
The chat attachment also persisted through Convex.
The test then removed its guest, archived its QA bot, and unloaded its model.
[Selected cat screenshot](../artifacts/followup/live-selected-cat.png).

The Mac wrapper now handles PNG downloads through WebKit and a native save dialog.
It accepts only PNG downloads from local screenshot blobs.
The native smoke check passed for workspace startup and a real PNG download through WebKit.
The rebuilt app and ZIP include this change.
All 28 runtime tests passed with the app's supported Node 22 runtime.

### Cleaner Mac window

The Mac window now extends its content behind a transparent, hidden title bar.
The separate title strip and separator are gone.
Native close, minimize, and zoom controls remain available.
The area above the sidebar logo supports dragging and double-click zoom.
The Mac build and workspace startup check passed.

### Custom bot names and avatars

Bot creation now includes a name and a live avatar preview.
There are six colours: Pearl, Lilac, Mint, Sky, Peach, and Rose.
There are three styles: Pebble, Orb, and Pixel.
The chosen appearance persists in Convex for each bot.
Existing bots retain the original Pearl/Pebble appearance.

Select the bot name in the sidebar to rename it or change its avatar later.
The chosen avatar appears in navigation, chat messages, welcome screens, and activity indicators.
Desktop context also includes the chosen bot name.
The preview retains cursor tracking and reduced-motion support.
The settings dialog now scrolls within the available height and uses the selected theme.

The local Convex and browser check passed for creation, editing, reload persistence, and keyboard access.
It also covered invalid-choice rejection, unrelated settings updates, and mobile/light/dark layouts.
Frontend and Convex TypeScript checks passed.
Temporary QA bots were archived after the check.

### Window dragging correction

The Mac window now has a 32-pixel drag area across its full width.
It is a native sibling of the browser view, with top-edge layout constraints.
Mac-only spacing keeps the logo, menus, and header controls below that area.
The browser version keeps its existing layout.
The native startup check covers hit detection inside and below the drag area.


### Smaller local Holo models

The registry now includes three Holo 3.1 Q4_K_M options with matching F16 vision projectors.

| Model | Full download | GGUF repository |
|---|---:|---|
| Holo 3.1 0.8B | 0.88 GB | [mradermacher](https://huggingface.co/mradermacher/Holo-3.1-0.8B-GGUF) |
| Holo 3.1 4B | 3.74 GB | [prithivMLmods](https://huggingface.co/prithivMLmods/Holo-3.1-4B-GGUF) |
| Holo 3.1 9B | 6.55 GB | [prithivMLmods](https://huggingface.co/prithivMLmods/Holo-3.1-9B-GGUF) |

These are community conversions of H Company's Apache 2.0 models.
The picker labels them as experimental.
Running a model needs additional memory beyond its download size.
All six files have pinned repository revisions, exact byte sizes, and SHA-256 checksums.
The launcher now selects each entry's actual weight and projector filenames.
The existing Holo4 paths and selection remain compatible.

The [official Holo 3.1 model card](https://huggingface.co/Hcompany/Holo-3.1-4B) documents the smaller family and native function calling.
I limited this update to Holo 3.1, which documents native function calling.
Only the 0.8B entry was downloaded for the local compatibility check.
The 4B and 9B entries remain optional downloads and have not been run on this Mac.

The 0.8B compatibility check loaded both files with the installed Metal build of llama.cpp.
The model answered a text request and correctly read TANGERINE from a controlled image.
It produced a tool call that passed Halo's schema validation.
Its proposed coordinates missed the visible button.
It also ignored the exact-format text instruction.
The strict grounding check therefore failed.
The picker includes these limitations beside the model.
The model was unloaded after the check, and the original model selection was restored.

The full runtime suite passed 29 tests.
The UI check passed with all five registry choices and the existing thread, memory, and private-login controls.
The final picker check passed on desktop and mobile with the compatibility notes visible.
The 0.8B model is downloaded, while 4B and 9B remain optional downloads.
Halo is open with the original Holo4 35B selection and all models off.


### Faster Mac startup

Cold-process startup averaged 3.26 seconds before the change across two samples.
It averaged 2.36 seconds after the change across three samples.
This is about 28 percent faster on this Mac.
The measurement ends when the chat input and sidebar are present in the native webview.
It excludes model loading, which remains an explicit action.

The launcher now reuses the web build when its content fingerprints match.
The fingerprint covers sources, public assets, shared code, Convex code, configuration, and dependency locks.
It also covers relevant Vite environment values and the Node/platform version.
The launcher checks the built output for missing or changed assets.
A missing or invalid cache triggers a normal build.
The Mac build script records the cache after a successful build.

The launcher skips token setup when an authenticated query already succeeds.
It still waits for successful Convex function preparation before starting the executor.
Native and launcher readiness polling now use shorter startup intervals.
The regular service monitor retains its existing interval.

The full runtime suite passed 31 tests.
Cache regressions cover same-timestamp source edits, changed dependency locks, missing assets, corrupt output, and invalid manifests.
A real missing-cache launch also rebuilt the UI and reached the usable workspace.
All measured launches stopped their owned services cleanly.
Timing reports are in `artifacts/startup/`, with the latest stage timings in `logs/startup-*.json`.

### Sidebar controls and a simpler workspace

The workspace no longer shows the bot/thread breadcrumb row.
The model picker now lives at the bottom of the left sidebar.
The theme toggle is an icon beneath it, with a tooltip and accessible label.
The static “Inference on your Mac” label is gone.
That label had no action or setting attached to it.
The model picker still shows the selected model and its actual readiness state.
Narrow layouts use compact model and theme icons in the sidebar row.
The Mac's native drag area remains available above the workspace.

The browser check passed for the removed header, sidebar control placement, and icon-only theme control.
It also passed for both themes, laptop/mobile layouts, model selection, and existing bot/thread controls.


### Text greetings after desktop activity

A text greeting failed because desktop status records entered the model context as system messages.
The model template rejects system messages after the first conversation turn.
The local model was healthy, but the request failed before generating a reply.
This was an application context bug rather than a requirement for image input.

The text context now excludes stored system/status records before applying its size budget.
The app still shows those records in history.
Bot instructions and saved memory remain in the leading instruction message.
Existing conversations do not need deletion or migration.
Deterministic local generation errors no longer receive automatic SDK retries.

The runtime suite passed 33 tests.
A live check seeded desktop status history in a temporary QA thread.
The running Holo4 model answered both “hello” and “How are you?” through the real chat UI.
Both replies remained visible after reload.
No VM was started, user history was not changed, and the test bot was archived.
The user's loaded Holo4 model remains ready.


### Complete text replies and coloured presence

Text responses now appear in full after generation finishes.
The text path no longer requests or publishes streaming deltas.
A final mutation checks the run before saving the answer.
Cancelled and obsolete runs cannot publish late answers.

The waiting indicator sits directly in the conversation, without a message bubble.
Its text, three animated dots, and glow use the selected avatar colour.
The avatar gently bobs, tilts its halo, and shifts or blinks its eyes.
The label changes for reply preparation, thinking, actions, result checks, approval, and stopping.
Light mode uses a darker shade of the same colour for contrast.
Reduced-motion settings disable the animations.

The live check confirmed one complete reply appeared without partial text.
It covered colour matching, the absence of a status bubble, both themes, and reduced motion.
It also covered reload persistence, cancellation, late-result rejection, and a subsequent greeting.
The runtime suite still passed all 33 tests.
The temporary QA bot was archived after the check.
