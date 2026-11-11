# Live validation — 11 November 2026

These checks used the local Holo4 model and a disposable Cua Linux VM on the user's Mac.
The user authorised both services for testing. Both were stopped when branding became the priority.
No real website account was used.

## Passed

- Online QEMU startup with the pinned Cua SDK, browser, and network gateway.
- Local text inference and model-driven navigation from screenshots.
- Private login on the public demo at `https://the-internet.herokuapp.com/login`.
- Saving the demo account in the app's macOS Keychain service, reusing it, and deleting it.
- Masking the filled fields, matching page instructions, and the displayed username after login.
- Downloading `sample.csv` into `/tmp/holo-downloads`, with a recorded size of 96 bytes.
- Completing that download task with one navigation and one click, using filesystem observations for verification.
- An eight-action task: navigate, add five elements, remove two, and finish with three Delete buttons.
- Opening a login URL without asking for credentials or signing in.
- A guest connection to the project web server through the VM host alias was blocked.
  The gateway log recorded `default:host-loopback` for that attempt.

## Fixes from these checks

The Cua 0.21.0 release bundle omitted `cua-netgw`.
Setup now builds the helper from the matching source commit inside the project cache.
The Go toolchain checksum and source revision are pinned. No system-wide installation or unrestricted network fallback is used.

The browser's download controller now stays attached and enables completion events.
The agent receives current download observations between steps rather than only at completion.
Only filenames already present in the user's goal enter model context.

Completion checks now receive a minimal executed-step trail.
Button labels enter that trail only when already named in the user's request.
Private fills do not record their values. Pixel coordinates do not enter subsequent model context.

Repeated actions pause a task when the screen also fails to progress.
This allows intentional repeated clicks when each click changes the page.

## Remaining work

MFA codes, CAPTCHA handoff, and multiple saved accounts were deferred when the user prioritised branding.
Longer offline practice-form regressions and adversarial timing tests inside the actual guest remain pending.
Masking cannot guarantee protection against every hostile rendering technique.
