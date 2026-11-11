# halo brand pack

This pack holds the halo logo (concept V2, the tilted ring) as SVG, PNG and favicon files.
The name halo is a working name. Nobody has checked it for trademark conflicts.

## Files

| Folder | File | Use |
| --- | --- | --- |
| `svg/` | `halo-symbol-black.svg`, `halo-symbol-white.svg` | Symbol only. Transparent background. |
| `svg/` | `halo-lockup-black.svg`, `halo-lockup-white.svg` | Symbol and wordmark, horizontal. Transparent background. |
| `svg/` | `halo-wordmark-black.svg`, `halo-wordmark-white.svg` | Wordmark only. Transparent background. |
| `svg/` | `halo-symbol-adaptive.svg`, `halo-lockup-adaptive.svg` | Black in light mode and white in dark mode. |
| `svg/` | `halo-app-icon-dark.svg`, `halo-app-icon-light.svg` | Symbol on a rounded tile. |
| `png/` | Symbol at 64, 256 and 1024 pixels | Raster copies of the symbol. |
| `png/` | Lockup at 100 and 400 pixels high, wordmark at 400 pixels high | Raster copies of the lockup and wordmark. |
| `png/` | App icon at 512 and 1024 pixels | Raster copies of the app icon. |
| `favicon/` | `favicon.svg` | Adaptive favicon for current browsers. |
| `favicon/` | `favicon.ico`, `favicon-16.png`, `favicon-32.png`, `favicon-48.png` | Favicon for older browsers. White ring on a black tile. |
| `favicon/` | `apple-touch-icon.png`, `icon-192.png`, `icon-512.png` | Home screen and web app manifest icons. |

The adaptive files follow `prefers-color-scheme`. They adapt only when the SVG loads as a file, for example in an `<img>` tag or as a favicon.
Use the black file on a light background and the white file on a dark background when you set the theme in the app.

## Colours

| Name | Value |
| --- | --- |
| Black | `#0A0A0B` |
| White | `#FBFBFA` |

The logo has no other colour. Do not add a gradient or a glow to it.

## Geometry

- The symbol is one elliptical ring on a 100 by 100 unit canvas.
- The outer ellipse has radii of 44 and 27 units. The inner ellipse has radii of 25 and 10 units.
- The ring turns 18 degrees anticlockwise around the centre of the canvas.
- The ring is 19 units thick at the sides and 17 units thick at the top and bottom.

## Wordmark

- The typeface is Outfit at weight 600, in lowercase, with letter spacing of -0.02 em.
- The wordmark is converted to outlines. The SVG files do not need the font.
- Outfit uses the SIL Open Font License. `OUTFIT-OFL.txt` holds the licence text.

## Lockup

- The lockup is 100 units high. The symbol canvas is the left 100 units.
- The x-height of the wordmark is 46 units. It is centred on the centre line of the symbol.
- The space between the ring and the letter h is 20 units.

## Spacing and size

- Keep clear space on all sides equal to one quarter of the symbol width.
- The minimum size of the symbol is 16 pixels wide.
- The minimum height of the lockup is 20 pixels.

## Favicon markup

```html
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
```
