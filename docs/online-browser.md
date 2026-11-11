# Online browser preview

This feature is experimental. Unit tests use fake guests and fake credentials.
A separate [isolated browser check](browser-checks.md) tests rendered dummy pages in Chrome without a VM or model.
The model and VM were not started for this implementation, at the user's request.
Live startup, website compatibility, downloads, and login masking still need testing with dummy accounts.

## Start an online session

1. Run `bash scripts/poc.sh setup` to install the project dependencies.
2. Run `bash scripts/poc.sh` to start the web app.
3. Select **Enable web access** before clicking **Start sandbox**.
4. Enable desktop context and ask Holo to open `https://example.com`.
5. Approve navigation, or use the existing automatic approval setting.

The checkbox applies to the new VM. Changing network mode requires stopping that VM and starting another.
Online startup installs pinned Playwright Python inside the guest. It uses the guest's existing Chromium browser.
The guest needs Python venv support. A setup failure stops and removes the guest rather than using a host browser.

[Cua's network option](https://cua.ai/docs/cua-sdk/reference/spaces) supplies outbound networking.
This app requests `network='default'` only when the user enables web access.
Browser requests check public HTTPS addresses and reject resolved private IP addresses.
These checks are application filtering. They are not a VM firewall or a guarantee against DNS rebinding and private-network access.
No host folders or host input driver are connected.

The expanded preview shows the browser viewport. Online mouse and keyboard actions target that viewport inside the guest.
The agent has no shell tool. Fixed setup commands start the guest browser and its control service.

## Downloads

The guest browser saves files in `/tmp/holo-downloads`.
Click **Check guest downloads** to show file cards with names and sizes.
Files stay in the guest and are deleted with it. The app does not automatically export or execute downloaded files.

## Private login

When Holo sees a login page, it can request a private form in chat.
The form displays the exact HTTPS origin receiving the account.
An origin includes the scheme and hostname. Only the standard HTTPS port is supported.

Enter credentials in this form, not in an ordinary chat message.
**Fill private fields** enters the account into a single visible username field and password field.
It does not automatically submit the form. The agent can propose clicking the sign-in button afterward.
Ambiguous forms and cross-origin login frames fail closed.

**Save in macOS Keychain** is optional and off by default.
The app explicitly selects the macOS backend from [Python keyring](https://keyring.readthedocs.io/en/stable/).
There is no plaintext storage fallback. One account is stored per website origin under the app's own Keychain service.
The operating system can request permission when accessing the saved item.
**Use saved account** requires an explicit click. Automatic action approval does not release a saved credential.
**Forget saved account** deletes that website's saved item.

The backend checks the current browser origin before releasing a credential.
The guest checks it again before filling the fields.
Only an account reference, status, and masked screenshots belong in model context.
The private form uses a separate endpoint from the chat transport.

Decrypted values pass through backend memory and a private tmpfs request file inside the guest.
They are not placed in command arguments, chat memory, or application logs.
The request file is deleted after reading. Values used for masking remain in private guest memory until the VM stops.
Browser session cookies remain inside the guest browser session.
The online context blocks service workers and WebSockets during this preview.

[Playwright screenshot masks](https://playwright.dev/python/docs/api/class-page#page-screenshot-option-mask) cover input fields.
After credential use, masks also cover matching credential text, case and spacing variants, images, video, canvases, SVG, and iframes.
Closed shadow content blocks the private view because its rendered contents cannot be inspected safely.
A failed masking operation returns an error. It never falls back to an unmasked desktop screenshot.

This is not an absolute guarantee against a hostile website.
A page could transform or render a secret in an unexpected way. The website receiving a password also receives its plaintext value.
Use dummy accounts until live masking tests pass. CAPTCHA, MFA, and multi-account selection need further work.

## Completion checks

After an action sequence, a separate model request assesses the current screenshot against the complete original goal.
Hidden, masked, missing, or uncertain results must not count as verified.
An invalid assessment pauses the task. Three identical consecutive actions also pause it.
This reduces unsupported completion claims; a model assessment can still be wrong.

## Test without starting a VM or model

```sh
.venv/bin/python -m unittest discover -s tests -v
npm run build --prefix web
```

Tests check origin restrictions, stale requests, secret-safe errors, masking requests, opt-in networking, and completion validation.
They do not read or write real Keychain credentials.
