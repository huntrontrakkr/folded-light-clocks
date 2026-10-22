# Clocks of folded light

Five clocks that keep time in caustics, traced live in the browser: light from one LED, folded by turning plates
of clear acrylic into a different picture each hour (Folded Light, second and first editions) or each hour of a
twelve-hour dial (The Twelve Keys).

- `index.html`, `style.css`, `clock.js`: the page and the WebGL 2 tracer.
- `toki.js`: Edo sun time for the Toki clock (NOAA solar position; dawn six and dusk six at 7.36° below the
  horizon; six toki of day and six of night; bell counts; the 24 solar terms). `sound.js` rings its bells.
- `data/<clock>/`: each clock's plate slope fields (`slopes.f16`) and settings (`clock.json`), exported from the
  design repository by `tools/web_export.py`.
- Film links: set `film` in `CLOCKS` at the top of `clock.js` to a YouTube URL.

URL options: `?clock=netsuke|toki|twelve-keys|minute-clock|folded-light`, `&speed=60` (an hour a minute), `&at=2026-10-03T11:00:30`.
Toki: `&lat=40.71&lon=-74.01` (whose sun; default the main city of the browser's time zone) or `&place=edo`.
