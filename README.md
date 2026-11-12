<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/design/halo-brand-pack/svg/halo-lockup-white.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/design/halo-brand-pack/svg/halo-lockup-black.svg">
    <img src="docs/design/halo-brand-pack/svg/halo-lockup-black.svg" alt="Halo" width="210">
  </picture>
  <p>A local AI assistant with its own desktop.</p>
  <p>Apple silicon · Local models · Native Mac app</p>
  <p><a href="#get-started">Get started</a> · <a href="docs/guide.md">Operating guide</a> · <a href="docs/convex-architecture.md">Architecture</a> · <a href="TODO.md">Roadmap</a></p>
</div>

[![Halo opens Google from a blank browser, finds a black and white kitten, and shares a screenshot in chat](docs/images/halo-cat-demo.gif)](docs/images/halo-cat-demo.mp4)

Halo opens google.com from a blank browser, finds a black and white kitten in Google Images, and shares a screenshot in chat.
Google's CAPTCHA was completed before this take. Model waits are shortened.
[Watch the video](docs/images/halo-cat-demo.mp4) · [View a still image](docs/images/halo-cat-demo.png)

Halo runs H Company's Holo models on your Mac through llama.cpp and Apple Metal.
Chat with your bots, give them saved memory, and let them work in a separate Linux desktop.
The app stores conversations locally with Convex.

## What you can do

- Create named bots with their own instructions, saved memory, avatar colour, and style.
- Keep separate conversation threads and return to them after restarting the app.
- Download, load, switch, and unload local models from the sidebar.
- Give a bot a disposable desktop with optional web access.
- Review each desktop action or enable automatic approval for that sandbox.
- Share desktop screenshots in chat and save them as PNG files.
- Use private login forms with optional macOS Keychain storage.

## A closer look

<table>
  <tr>
    <td width="50%"><img src="docs/images/models.png" alt="Halo local model picker" width="100%"></td>
    <td width="50%"><img src="docs/images/avatars.png" alt="Halo bot name, avatar colour, and style settings" width="100%"></td>
  </tr>
  <tr>
    <td align="center">Choose a model that fits your Mac.</td>
    <td align="center">Give each bot its own name and appearance.</td>
  </tr>
</table>

The recording uses a separate demo conversation and a live website.
The screenshots above use demo bots and a local practice form.

## Get started

On an Apple silicon Mac with [Homebrew](https://brew.sh) and Apple's Command Line Tools, run:

```sh
curl -fsSL https://raw.githubusercontent.com/rk68/halo/main/install.sh | bash
```

The installer downloads Halo, installs missing Node.js, QEMU, and llama.cpp dependencies, and builds the Mac app.
Open **Halo** in your user **Applications** folder.
Choose a model from the sidebar when you are ready.
Models and sandboxes stay off until you request them. The first model download can be large.

### The halo command

The installer adds `~/.local/bin/halo`.
If that directory is on your `PATH`, you can use:

```sh
halo          # Open the Mac app
halo install  # Rebuild the installed app and prepare dependencies
halo start    # Start the browser app at http://127.0.0.1:8765
```

You can also run `~/.local/bin/halo` directly.
From an existing checkout, use `./halo install`.
The default checkout stays in `~/.local/share/halo`. Keep it in place.
The installer preserves existing conversations and models. It does not update the checkout or edit your shell profile.
See the [operating guide](docs/guide.md) for manual setup and build commands.

The Mac app uses Swift, AppKit, and WebKit around the React interface.
It starts the local workspace when needed. This is an ad hoc signed local build, not a notarized standalone distribution.

## Models

| Model | Download including vision projector | Status |
| --- | ---: | --- |
| Holo4 35B A3B | 22.2 GB | Default |
| Holo4 27B | 17.8 GB | Non-commercial use |
| Holo 3.1 0.8B | 0.88 GB | Experimental community conversion |
| Holo 3.1 4B | 3.74 GB | Experimental community conversion |
| Holo 3.1 9B | 6.55 GB | Experimental community conversion |

Running a model needs more memory than its download size.
The Holo 3.1 conversions have limited desktop validation.
The model picker shows the source, licence, and known limits for each entry.
See the [model setup notes](docs/guide.md#start-halo) for file verification and manual server use.

## How it runs

| Part | Stack |
| --- | --- |
| Interface | React, TypeScript, Vite |
| Local data and agent runs | Convex and the Convex Agent component |
| Desktop executor | Node.js, TypeScript, Cua, QEMU |
| Model inference | llama.cpp with Apple Metal |
| Mac window | Swift, AppKit, WebKit |

The normal app runtime does not require Python.
The original Python implementation remains as a regression reference.

## Local data and desktop access

- The app and Convex bind to loopback addresses.
- The sandbox controls a separate Linux VM. It does not control your Mac or mount host folders.
- New sandboxes have no outbound network access unless you enable it.
- Saved memory is explicit and belongs to one bot. Halo does not extract it automatically.
- Private login fields bypass chat and model requests. Optional saved accounts use macOS Keychain.
- Enabling web access lets the sandbox contact external websites.

Private-field masking and URL filtering have limits.
Use demo accounts until you review the [private login notes](docs/guide.md#private-login) and [live validation results](docs/overnight-briefing-2026-11-12.md).

## Development

```sh
npm test --prefix runtime
npm run check --prefix runtime
npm run build --prefix web
web/node_modules/.bin/tsc --noEmit -p web/convex/tsconfig.json
```

See the [operating guide](docs/guide.md) for browser checks, sandbox cleanup, model diagnostics, and screenshot tests.
The [architecture guide](docs/convex-architecture.md) describes service boundaries.
The [roadmap](TODO.md) tracks remaining work, including collaboration between bots.

## Project notes

- [Operating guide](docs/guide.md)
- [Latest implementation briefing](docs/overnight-briefing-2026-11-12.md)
- [Halo brand assets and font licence](docs/design/halo-brand-pack/README.md)
- [Holo4 model card](https://huggingface.co/Hcompany/Holo4-35B-A3B-GGUF)
