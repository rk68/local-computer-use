# Browser checks without a model or VM

The optional check opens one isolated headless Chrome process with dummy pages.
It does not start llama.cpp, Cua, or a VM. It does not use a personal browser profile or real credentials.
The UI receives fake API responses from a temporary loopback server.
Login fixtures use a temporary local HTTPS certificate. Certificate bypass applies only to those fixtures.

## Run on this Mac

Google Chrome must already be installed. The script does not download a browser.

```sh
python3 -m venv .cache/browser-check-env
.cache/browser-check-env/bin/pip install -r requirements-browser-check.txt
npm run build --prefix web
.cache/browser-check-env/bin/python scripts/check_browser.py
```

The browser, fixture servers, temporary certificate, and dummy credential files are removed when the script ends.
UI screenshots are saved in `artifacts/ui-offline-review.png` and `artifacts/ui-offline-mobile.png`.
They contain fixture data rather than a real conversation.

## Coverage

The browser check exercises the actual guest browser operations against rendered dummy pages.
It checks input masks, reflected credentials, uppercase text, invisible spacing, canvas, inline SVG, and iframe masks.
It also checks rejection of a changed origin before filling fields.
A closed shadow tree blocks the private view rather than producing a potentially unsafe screenshot.

The UI check covers three laptop sizes and mobile width.
It checks welcome content, preview clipping, sidebar persistence, composer growth, notices, private forms, and the light theme.
The private form must use its own endpoint. Dummy credentials must not appear in the message log.

The unit suite adds checks for window creation order and secret-safe errors.
It verifies that privacy failures never read an old screenshot.

## Remaining checks

This is not a full Linux VM test. Guest provisioning, Linux dependencies, network behaviour, and Keychain permission prompts remain untested here.
Real websites, redirects, downloads, MFA, CAPTCHA, and long model-driven tasks need separate testing.
Screenshot masking still cannot guarantee protection against every hostile rendering technique or timing attack.
Use dummy accounts for that next phase.
