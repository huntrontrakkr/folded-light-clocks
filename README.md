# Clocks of folded light

Three clocks that keep time in caustics, traced live in the browser: light from one LED, folded by turning plates
of clear acrylic into a different picture each hour (Folded Light, second and first editions) or each hour of a
twelve-hour dial (The Twelve Keys).

- `index.html`, `style.css`, `clock.js`: the page and the WebGL 2 tracer.
- `data/<clock>/`: each clock's plate slope fields (`slopes.f16`) and settings (`clock.json`), exported from the
  design repository by `tools/web_export.py`.
- Film links: set `film` in `CLOCKS` at the top of `clock.js` to a YouTube URL.

URL options: `?clock=netsuke|twelve-keys|folded-light`, `&speed=60` (an hour a minute), `&at=2026-10-03T11:00:30`.
