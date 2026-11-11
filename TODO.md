# UI follow-up

- [ ] Review the latest UI changes after the user is ready to test.
- [x] Present three original logo concepts. See `docs/design/logo-concepts.svg`.
- [x] Refine directions 01 and 02. See `docs/design/logo-refinements.svg`.
- [ ] Get the user’s final logo choice before changing the current mark.

The model and VM must stay off during UI work unless the user requests otherwise.

## Logo brief

Keep the brand mark separate from Holo's chat avatar. The user likes the existing serif “h” as a starting point.
Explore original geometric shapes, balanced curves, and clear cutouts. Use the references for direction without copying a mark.
Compare a custom “h”, an “hl” monogram, and a portal or orbit symbol.
The latest reference emphasises rounded letterforms and deliberate cutouts.

The mark must work in one colour, in both themes, and at 16, 24, and 32 pixels.
Pair it with a clean hololocal wordmark. Deliver SVG versions for the sidebar and favicon.

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
- [ ] Test online VM startup, downloads, and private login with dummy accounts when the user resumes VM testing.
- [ ] Check long tasks against real screenshots when the local model is available.
- [ ] Test screenshot masking against changing pages and deliberate credential exposure.
- [ ] Add CAPTCHA, MFA, and multi-account support after the basic login flow passes live tests.
