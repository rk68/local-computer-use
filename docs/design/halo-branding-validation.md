# Halo branding validation

Validated on 11 November 2026 without starting the model or VM.

- Use the approved V2 SVG lockups without changing their geometry or outlines.
- Match the black or white logo to the selected app theme.
- Keep quarter-symbol clear space and exceed the minimum lockup height.
- Serve Outfit locally as a variable WOFF2 font with the supplied SIL licence.
- Keep existing preferences, chat storage, API identifiers, and Keychain service names.
- Keep Holo4 as the model name and Halo as the assistant name.

## Checks

The production build and all 64 unit tests pass.
Isolated Chrome checks pass at 1280×720, 1366×768, 1440×900, and 390 pixels wide.
They check font loading, logo theme selection, icons, composer growth, and notice dismissal.
The laptop welcome view has no page overflow or clipped desktop content.
The checks use dummy browser pages and an isolated profile.

The running local server serves the new font, SVGs, icons, and manifest with correct MIME types.
SVG responses permit only their embedded style hashes through Content Security Policy.
The VM remained stopped and port 8080 had no model listener after these checks.
