# RivetHub redesign canvas (source)

Editable source for the design canvas these mockups came from. The live
canvas has the working switches (theme, font, accent, the details panel):
https://claude.ai/artifact/D4FaRKwGZqFQAtTt4u63Qx

| File                | What it is                                                      |
| ------------------- | --------------------------------------------------------------- |
| `canvas.json`       | Canvas index: artboard names, positions and sizes               |
| `Main.dc.html`      | A · Tiled (Omarchy native), with the collapsible details panel  |
| `Waybar.dc.html`    | B · Bar-first, no sidebar                                       |
| `Synthwave.dc.html` | C · Synthwave '84                                               |
| `Logos.dc.html`     | Logo options: Hub, Tile, Join                                   |
| `Colorways.dc.html` | Logos in green, orange and red                                  |
| `render.cjs`        | Turns the artboards into the static HTML and PNGs one folder up |

Each `.dc.html` is a Design Component: normal HTML, plus `{{holes}}` filled
from the `renderVals()` script at the bottom. The `data-props` on that script
list the switches (theme, font, accent and so on).

## Re-rendering the PNGs

Needs Node, Playwright, and the fonts (JetBrains Mono, Fira Code, IBM Plex
Mono, Orbitron, Space Mono) installed locally.

```bash
cd docs/mockups/rivethub-redesign/canvas
node render.cjs . ..    # set CHROMIUM_PATH to use a specific Chromium
```
