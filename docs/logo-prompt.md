# Moto Infinite: best logo prompts for GPT Image

Design advice from game-logo guides and AI-icon prompt guides:
- **Make two marks.** An **icon** (no text: browser tab, phone home screen, Google sign-in) and a
  **logotype** (name + symbol: menu title, store page). Most game logos are too detailed to work as icons.
- **Shape over detail.** Thin lines and small details disappear at 32 px; only the silhouette survives.
- **No text in the icon.** Text is unreadable at small sizes, and AI adds odd letters unless told not to.
- **One bold central symbol, 2–3 colours, flat vector style, square, with padding.**
- **Test it.** View the result at 32 px and as a solid black silhouette. If you can still tell what it is, it works.

---

## 1) ICON: the main logo (use this one first)

Copy everything in the box into ChatGPT:

```
Design a professional app icon for a video game called "Moto Infinite"
(an endless low-poly motorbike and racing game).

CONCEPT: One bold, instantly recognisable symbol: an infinity sign (∞) drawn as a
glowing race track / tyre trail, with a sleek low-poly sport motorcycle riding along the top
curve of the loop, leaning into the turn. The motorcycle and the infinity loop merge into
one strong combined silhouette. Motion is shown by 2–3 short speed streaks behind the bike.

STYLE: Modern flat vector app icon with a subtle low-poly faceted look on the bike
(3–6 clean facets, no tiny details). Bold thick shapes, crisp edges, smooth curves,
high contrast. Minimal and premium, like a top App Store game icon.

COLOURS (exact):
- Background: deep night navy #0c101c with a soft circular glow behind the symbol
- Infinity track: neon yellow #ffd23f, thick stroke, slight glow
- Motorcycle: electric cyan #3cc8ff with lighter cyan facet highlights
- Accents: a little white for highlights only. No other colours.

COMPOSITION: Perfectly centred, square 1:1, the symbol fills about 65–70% of the canvas,
equal padding on all sides, rounded-square app-icon background.
It must stay clear and recognisable at 32 x 32 pixels and as a solid black silhouette.

AVOID: any text, letters, numbers or words; real brand logos or badges; a rider's face;
photorealism; 3D render clutter; thin lines; tiny details; busy background; extra objects;
watermark; signature; frame.

OUTPUT: 1024 x 1024 px, PNG.
```

---

## 2) LOGOTYPE: name + symbol (menu title, store page, social)

GPT Image 2 can now render text cleanly. Use it **after** you've chosen the icon:

```
Using the same symbol, colours and style as the icon I just made, design a horizontal
game logotype for "MOTO INFINITE".

The symbol on the left, the words "MOTO INFINITE" on the right in a bold, wide,
italic racing typeface (custom-looking, sharp, slightly slanted forward for speed),
"MOTO" in white and "INFINITE" in neon yellow #ffd23f, with a thin cyan #3cc8ff speed line
under the text. Spell the text exactly: MOTO INFINITE.

Transparent background (or navy #0c101c if transparency isn't possible), flat vector style,
high contrast, no extra words, no tagline, no watermark. Wide 3:1 format, 1536 x 512 px PNG.
```

---

## 3) If you want options first

```
Show me 4 different app icon concepts for "Moto Infinite" in a 2x2 grid, same colours
(navy #0c101c, neon yellow #ffd23f, cyan #3cc8ff), flat vector, no text:
1) motorcycle on an infinity-loop track
2) a single glowing wheel whose trail forms ∞
3) front view of a motorcycle headlight inside an ∞ shape
4) the letter M built from an ∞ track with a bike on it
```
Pick the best, then say: *"Make concept 2 as a full 1024 x 1024 icon using the full spec above."*

---

## Fixes (send as follow-up messages)
- "Simpler: fewer details, thicker shapes, so it reads at 32 px."
- "Remove all text, letters and numbers."
- "Make the infinity loop thicker and brighter; the bike slightly bigger."
- "Centre it with more equal padding."
- "Use exactly #0c101c for the background, no other background colours."
- "Flatter, less 3D, more like a vector icon."

## Check before using it
1. Shrink it to 32 px. Can you still see a bike and a loop?
2. Make it black and white. Is the shape still clear?
3. Does it look good on both dark and light backgrounds?

## Then
- Send me the **1024 x 1024 icon PNG**. I'll make the browser icon, installed-app icons
  (192, 512, maskable) and the iPhone home-screen icon, and can put the logotype on the main menu.
- **Google sign-in screen:** a 120 x 120 PNG under 1 MB. Uploading a logo there makes Google
  **review** the app (can take days or weeks), so publish first without it and add it later.
