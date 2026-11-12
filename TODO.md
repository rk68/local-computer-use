# Overnight follow-up — 12 November 2026

Questions, decisions, validation, and the morning handoff are recorded in `docs/overnight-briefing-2026-11-12.md`.

- [x] Extend the chat/desktop divider to the bottom of the page.
- [x] Simplify the desktop controls, align buttons, and use consistent quality icons.
- [x] Add an in-app model picker for compatible Holo computer-use models.
- [x] Manage local model startup from the app rather than a separate shell command.
- [x] Explore Codex/Claude subscription access and their computer-use model/tool boundaries.
- [x] Give Halo avatars depth and make them look toward a nearby pointer.
- [x] Recheck credential storage, private filling, and masking; test safely where possible.
- [x] Research Grok's desktop stack and prepare a Mac desktop version if existing code can be reused reasonably.
- [x] Review the full remaining TODO list and record completed, deferred, or blocked items with evidence.

# Cua TypeScript executor migration — complete

The latest request in the previous personal-account Codex thread was to move the
Cua desktop executor from Python to TypeScript. That turn stopped at the account
usage limit on 11 November 2026, before the executor was implemented.

- [x] Create the initial `runtime/package.json` and lockfile with `@trycua/cua`.
- [x] Verify the TypeScript SDK covers local QEMU, screenshots, input, files, network isolation, and guest cleanup.
- [x] Port the Python executor to `runtime/src/`, preserving per-thread ownership, approvals, action limits, private login, credential masking, and Keychain handling.
- [x] Verify the TypeScript executor with fake guests and the existing Convex desktop integration.
- [x] Switch setup, launcher, and cleanup commands to the verified TypeScript runtime and update the setup documentation.
- [x] Run live Holo4 and real-VM checks when requested and resource use permits.

Recovered on 12 November 2026 from personal-account thread
`01a1c248-b17c-7091-b90b-977ca1548cc3`.
The last completed commit was `d93b5d6` (local Convex bots, threads, and streaming).
`runtime/src/` was empty at recovery. The default launcher now uses the completed TypeScript executor.
The overnight request authorized the outstanding live checks. Those checks passed, and all test models and VMs were stopped.

# UI follow-up

- [x] Review UI with isolated browser fixtures at three laptop sizes and mobile width.
- [ ] User to review the real app when ready.
- [x] Present three original logo concepts. See `docs/design/logo-concepts.svg`.
- [x] Refine directions 01 and 02. See `docs/design/logo-refinements.svg`.
- [x] Package all seven original references and a brief for the designer. See `docs/design/logo-references/README.md`.
- [x] Receive the approved Halo brand pack from the designer. The implementation checklist is below.

The model and VM must stay off during UI work unless the user requests otherwise.

## Halo rebrand — approved assets

- [x] Import the supplied brand pack into `docs/design/halo-brand-pack/`, including its original guide and font licence.
- [x] Rename the visible product and assistant from hololocal/Holo to **halo** across the app and documentation.
- [x] Use the approved V2 tilted-ring symbol, outlined wordmark, and horizontal lockup from the pack.
- [x] Replace the current sidebar mark, page title, favicon, touch icon, and app icons.
- [x] Use the black and white assets according to the app's selected theme.
- [x] Load Outfit locally for interface typography. The pack specifies weight 600 and -0.02 em letter spacing for the lowercase wordmark.
- [x] Obtain the actual Outfit webfont files; the supplied wordmark is outlined and the pack includes the licence, but no font binaries.
- [x] Preserve `OUTFIT-OFL.txt`, check the pack's clear-space and minimum-size rules, and verify light/dark and mobile layouts.

The supplied brand guide is `docs/design/halo-brand-pack/README.md`.
The approved mark uses black #0A0A0B and white #FBFBFA, with no gradient or glow on the logo itself.
The original reference images below remain available as historical design context.

## User references

Saved on 11 November 2026, in the order supplied:

1. [Monochrome symbol grid](docs/design/logo-references/reference-01.png)
2. [Organic and geometric symbols](docs/design/logo-references/reference-02.png)
3. [Colour symbol grid](docs/design/logo-references/reference-03.png)
4. [Logo database examples](docs/design/logo-references/reference-04.png)
5. [Bold marks and wordmarks](docs/design/logo-references/reference-05.png)
6. [Geometric marks on gradient backgrounds](docs/design/logo-references/reference-06.png)
7. [Rounded letterforms and cutouts](docs/design/logo-references/reference-07.png)

## Further visual polish

- [x] Brighten the input glow with purple, pink, and a soft yellow accent. Increase it on focus in both themes.

## Online browser and reliability

- [x] Add an explicit web-access option. Keep offline mode as the default.
- [x] Keep browser downloads inside the VM and show file cards.
- [x] Add origin-scoped private login forms and optional macOS Keychain storage.
- [x] Mask inputs, known credential text, and media after credential use.
- [x] Add a separate completion assessment and a repeated-action guard.
- [x] Test online VM startup, downloads, private login, and Keychain save/reuse/delete with a demo account. See `docs/live-validation-2026-11-11.md`.
- [x] Verify an eight-action online task against real screenshots and the executed-step trail.
- [x] Run the longer offline practice-form regression. Real Holo4 completed and independently verified all fields and Save in six actions.
- [x] Check rendered masks against reflected credentials, case/spacing changes, media, and closed shadow content using dummy pages.
- [x] Validate masking inside the actual guest with controlled adversarial fixtures, including rapid text changes, reflected secrets, canvas, and closed shadow content. This does not prove protection against every hostile page.
- [x] Add named saved accounts and private one-time verification-code support. Native Keychain and rendered dummy-code checks passed.
- [ ] Add interactive CAPTCHA, push-approval, and hardware-key handoff. The agent currently pauses for a human. Real-account MFA remains untested.

## Deferred until after branding

- [x] Add verification-code support and multiple saved accounts. See the overnight briefing for implementation and test limits.

## Convex bots and threads

- [x] Check Convex Agent compatibility with the installed AI SDK and React versions.
- [x] Add local Convex, persistent bots and threads, and reactive message history.
- [x] Preserve the old SQLite transcript with an idempotent import.
- [x] Isolate guest ownership, approvals, and context by thread.
- [x] Check fake-model streaming and sandbox routing through real local Convex.
- [x] Run a live Holo4 and multi-VM regression. Two real guests stayed separate; stopping one preserved the other.
- [x] Add explicit per-bot saved memory to text and desktop context.
- [ ] Evaluate optional embeddings and cross-thread retrieval after reviewing memory scope. No automatic extraction or hidden cross-bot recall was added.
- [x] Add per-thread archive/rename and restore controls for archived bots.

## Follow-up: sessions, image results, and progress

- [x] Audit multiple threads and memory. History, approvals, and guests are separate per thread. Explicit saved memory applies across one bot's threads.
- [ ] Add multiple collaborating bots in one thread. Deferred: define participant roles, turn order, shared memory, and one owner for guest actions first.
- [x] Keep public search inputs visible. Mask private fields before login and all editable fields after private values enter the session.
- [x] Collapse action logs into an expandable activity trail. Add elapsed status and a distinct completion-check state.
- [x] Run the live orange-cat selection and sharing task on Wikimedia Commons. Three actions passed independent completion; Google paused at CAPTCHA.
- [x] Let Halo capture, save, and share screenshots in chat. Add a manual capture button, expansion, and PNG export.
- [x] Require a selected image or larger preview for image-selection completion. A results grid alone does not finish the task.
- [ ] Add screenshot retention and deletion controls. Captures persist locally, with a limit of 50 per thread.

## Bot identity

- [x] Add a name, avatar colour, and avatar style to bot creation, with a live preview.
- [x] Persist avatar choices per bot. Allow later edits and preserve existing bot defaults.
- [x] Apply the chosen avatar across navigation, chat, welcome, and activity indicators.
- [x] Check creation, editing, reload persistence, keyboard access, invalid choices, and mobile/light/dark layouts.
- [x] Make the clean Mac window draggable across a full-width native top strip, with controls below it.

## Smaller local models

- [x] Add Holo 3.1 0.8B, 4B, and 9B community GGUF entries with matching vision projectors.
- [x] Pin revisions, file sizes, and SHA-256 checksums. Keep model source and experimental status visible.
- [ ] Run longer desktop tasks with the smaller models before treating them as validated replacements for Holo4.
- [x] Check the 0.8B model on Metal. Record its successful image reading and tool-call format, plus failed exact-format and grounding checks.

## Startup performance

- [x] Measure native startup and launcher stages before and after optimization.
- [x] Reuse unchanged web builds with source, dependency, environment, and output checks.
- [x] Skip redundant local token setup and reduce readiness polling delays.
- [x] Check cache invalidation, real rebuild fallback, native startup, and owned-service shutdown.

## Sidebar cleanup

- [x] Remove the breadcrumb/header row and the static inference label.
- [x] Move the model selector to the sidebar footer and use an icon-only theme toggle beneath it.
- [x] Preserve model state, responsive controls, and the native Mac drag area.

## Conversation reliability

- [x] Fix text chat after desktop activity by excluding historical system/status events from model context.
- [x] Preserve visible history, bot instructions, and memory. Verify real greeting replies and reload persistence.

## Complete replies and presence

- [x] Show text replies all at once and prevent cancelled or obsolete runs from publishing late output.
- [x] Use standalone avatar-coloured thinking text and three animated dots, without a bubble.
- [x] Animate the avatar, halo, and eyes for waiting and task phases; respect reduced motion.
- [x] Check complete-reply publication, cancellation, persistence, colour matching, and both themes with the real model.
