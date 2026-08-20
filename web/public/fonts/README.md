# Preview fonts for the ZPL built-in fonts

These are the typefaces the label previews draw text with. They are **not** the
fonts the printer uses, and they cannot be — but their metrics are.

## Why not the printer's actual fonts

- ZPL's scalable font `0` is **CG Triumvirate Bold Condensed**, a commercial
  Monotype/AGFA typeface held in printer firmware. It is not a file in printer
  memory, there is no ZPL command that reads font bytes back to the host, and
  embedding it in a web app would need a separate webfont licence from Monotype.
- The bitmap fonts `A`–`H` are not font files at all. They are glyph bitmaps
  compiled into firmware, so there is nothing to download even in principle.
- `E:TT0003M_.TTF` **is** a real file on the printer (Swiss 721, which Zebra
  distributes free behind a support login), but it is a different typeface that
  only applies when a label explicitly calls it via `^A@`. It is not font `0`.

## What these are instead

Metric-matched, freely licensed substitutes, taken from the
[ZPLab](https://github.com/u8array/ZPLab) project. `PrintLab ZPL Bold` is Roboto
Condensed with every glyph's advance width and outline remapped to CG
Triumvirate Condensed Bold's measured metrics.

That remap was verified independently before adopting it here: comparing its
advance table against advances measured off Labelary renders (see
`useZplFonts.ts`), **94 of 95 printable ASCII glyphs agree to within 0.15% of the
em**, `~` being the only outlier at 1.5%. Two derivations from different sources
landing on the same numbers is the reason these are trusted for layout.

| File | Used for | Licence |
| --- | --- | --- |
| `PrintLabZPL-Bold.woff2` | font `0` | Apache 2.0 — see `PrintLabZPL-NOTICE.md`, `LICENSE-APACHE-2.0.txt` |
| `PrintLabMono.ttf` | fonts `A` `B` `C` `D` `F` `G` | Bitstream Vera — see `PrintLabMono-NOTICE.md`, `VeraMono-NOTICE.md` |
| `OCRA.ttf` | font `H` | See `OCRA-NOTICE.md` |
| `OCRB.ttf` | font `E` | See `OCRB-NOTICE.md` |

Keep the `*-NOTICE.md` files alongside the fonts: the Apache 2.0 and Bitstream
Vera licences both require their notices to travel with the files.

**Worth knowing if you ever sell this software:** OCR-A's upstream terms (Richard
B. Wales' original METAFONT) ask that no fee be charged for distribution beyond a
reasonable copying charge, and CTAN catalogues it "Do Not Sell Except by
Arrangement". That is more restrictive than this repository's MIT licence, so
`OCRA.ttf` is covered by its own notice rather than by MIT. It only affects the
preview of font `H`.

## Changing a face

The mapping from ZPL font to face, and the cap-height ratios each face needs,
live in `web/app/composables/useZplFonts.ts` (`ZPL_PREVIEW_FACES`). The ratios
were read from the `H` glyph outlines of these exact files, so swapping a file
means re-measuring them or capitals will come out the wrong height.
