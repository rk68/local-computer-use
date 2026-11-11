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
- [ ] Run the longer offline practice-form regression.
- [x] Check rendered masks against reflected credentials, case/spacing changes, media, and closed shadow content using dummy pages.
- [ ] Validate masking inside the actual guest, including hostile page timing and rendering changes.
- [ ] Add CAPTCHA, MFA, and multi-account support after the basic login flow passes live tests.

## Deferred until after branding

- [ ] Add verification-code support and multiple saved accounts.

## Convex bots and threads

- [x] Check Convex Agent compatibility with the installed AI SDK and React versions.
- [x] Add local Convex, persistent bots and threads, and reactive message history.
- [x] Preserve the old SQLite transcript with an idempotent import.
- [x] Isolate guest ownership, approvals, and context by thread.
- [x] Check fake-model streaming and sandbox routing through real local Convex.
- [ ] Run a live Holo4 and multi-VM regression when resource use is acceptable.
- [ ] Add explicit long-term memories and optional retrieval.
- [ ] Add per-thread archive/rename and restore controls for archived bots.
