// Toki: the twelve animals kept in Edo sun time (futei-jihō, "unfixed time").
//
// Edo Japan did not divide the day into equal hours. Daylight, from the "dawn six" bell to the "dusk six" bell, was
// cut into six equal toki, and the night into six more, so the hours stretched and shrank with the seasons: in Edo a
// midsummer day toki is about 156 minutes and a night toki about 84. Each toki was named by its animal and announced
// by temple bells: three warning strokes (sute-gane), then the count, nine at noon and midnight, down to four.
// Japan kept this time until 1873.
//
// Dawn six and dusk six are taken where the sun is 7.36° below the horizon, about half an hour before sunrise and
// after sunset at Edo's latitude. Sun positions follow NOAA's solar calculator (Meeus); the season is the sun's
// apparent longitude, read as the 24 solar terms (sekki) of the old calendar.

"use strict";

const TOKI = (() => {
  const DAY = ["rabbit", "dragon", "snake", "horse", "goat", "monkey"];     // from dawn six
  const NIGHT = ["rooster", "dog", "boar", "rat", "ox", "tiger"];          // from dusk six
  const BELLS = { rabbit: 6, dragon: 5, snake: 4, horse: 9, goat: 8, monkey: 7,
                  rooster: 6, dog: 5, boar: 4, rat: 9, ox: 8, tiger: 7 };
  const DAWN_ALT = -7.36;
  const DAY_MS = 86400000, D2R = Math.PI / 180;
  // the bell: three sute-gane, a breath, then the count (seconds after the toki begins)
  const SUTE = [0, 3, 6], COUNT0 = 10.5, STEP = 4.0;
  const SEKKI = [["risshun", "spring begins"], ["usui", "rain water"], ["keichitsu", "insects awaken"],
    ["shunbun", "spring equinox"], ["seimei", "clear and bright"], ["kokuu", "grain rain"], ["rikka", "summer begins"],
    ["shōman", "grain fills"], ["bōshu", "grain in ear"], ["geshi", "summer solstice"], ["shōsho", "lesser heat"],
    ["taisho", "greater heat"], ["risshū", "autumn begins"], ["shosho", "heat ends"], ["hakuro", "white dew"],
    ["shūbun", "autumn equinox"], ["kanro", "cold dew"], ["sōkō", "frost descends"], ["rittō", "winter begins"],
    ["shōsetsu", "lesser snow"], ["taisetsu", "greater snow"], ["tōji", "winter solstice"], ["shōkan", "lesser cold"],
    ["daikan", "greater cold"]];
  // where the viewer's sun is: ?lat=&lon=, ?place=edo, or the main city of the browser's time zone
  const ZONES = {
    "Asia/Tokyo": [35.69, 139.69], "America/New_York": [40.71, -74.01], "America/Detroit": [42.33, -83.05],
    "America/Chicago": [41.88, -87.63], "America/Denver": [39.74, -104.99], "America/Phoenix": [33.45, -112.07],
    "America/Los_Angeles": [34.05, -118.24], "America/Anchorage": [61.22, -149.9], "Pacific/Honolulu": [21.31, -157.86],
    "America/Toronto": [43.65, -79.38], "America/Vancouver": [49.28, -123.12], "America/Mexico_City": [19.43, -99.13],
    "America/Sao_Paulo": [-23.55, -46.63], "America/Buenos_Aires": [-34.6, -58.38], "Europe/London": [51.51, -0.13],
    "Europe/Dublin": [53.35, -6.26], "Europe/Lisbon": [38.72, -9.14], "Europe/Paris": [48.86, 2.35],
    "Europe/Berlin": [52.52, 13.4], "Europe/Madrid": [40.42, -3.7], "Europe/Rome": [41.9, 12.5],
    "Europe/Amsterdam": [52.37, 4.9], "Europe/Stockholm": [59.33, 18.07], "Europe/Moscow": [55.76, 37.62],
    "Asia/Shanghai": [31.23, 121.47], "Asia/Hong_Kong": [22.32, 114.17], "Asia/Seoul": [37.57, 126.98],
    "Asia/Kolkata": [28.61, 77.21], "Asia/Singapore": [1.35, 103.82], "Australia/Sydney": [-33.87, 151.21],
    "Australia/Melbourne": [-37.81, 144.96], "Pacific/Auckland": [-36.85, 174.76],
  };

  function place(params) {
    const lat = parseFloat(params.get("lat")), lon = parseFloat(params.get("lon"));
    if (isFinite(lat) && isFinite(lon)) return { lat, lon, name: `${lat.toFixed(2)}°, ${lon.toFixed(2)}°` };
    if ((params.get("place") || "").toLowerCase() === "edo") return { lat: 35.69, lon: 139.69, name: "Edo" };
    let tz = "";
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) { /* no Intl */ }
    if (ZONES[tz]) return { lat: ZONES[tz][0], lon: ZONES[tz][1], name: tz.split("/").pop().replace(/_/g, " ") };
    // unknown zone: the zone's own meridian, at Edo's latitude
    return { lat: 35.69, lon: -new Date().getTimezoneOffset() / 4, name: "your time zone" };
  }

  // NOAA solar position at time t (ms): declination (rad), equation of time (min), apparent longitude (deg)
  function solar(t) {
    const T = (t / DAY_MS + 2440587.5 - 2451545.0) / 36525;
    const L0 = ((280.46646 + T * (36000.76983 + T * 0.0003032)) % 360 + 360) % 360;
    const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
    const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
    const Mr = M * D2R;
    const C = Math.sin(Mr) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * Mr) * (0.019993 - 0.000101 * T)
            + Math.sin(3 * Mr) * 0.000289;
    const om = (125.04 - 1934.136 * T) * D2R;
    const lam = L0 + C - 0.00569 - 0.00478 * Math.sin(om);
    const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
    const eps = (eps0 + 0.00256 * Math.cos(om)) * D2R;
    const decl = Math.asin(Math.sin(eps) * Math.sin(lam * D2R));
    const y = Math.tan(eps / 2) ** 2, L = L0 * D2R;
    const eot = 4 / D2R * (y * Math.sin(2 * L) - 2 * e * Math.sin(Mr) + 4 * e * y * Math.sin(Mr) * Math.cos(2 * L)
                           - 0.5 * y * y * Math.sin(4 * L) - 1.25 * e * e * Math.sin(2 * Mr));
    return { decl, eot, lam: ((lam % 360) + 360) % 360 };
  }

  // the solar noon nearest t, and half the length of the Edo day (dawn six to dusk six), both in ms
  function sunDay(t, p) {
    const dayStart = Math.floor(t / DAY_MS) * DAY_MS;
    let noon = dayStart + (720 - 4 * p.lon) * 60000;                     // mean solar noon of this UTC date
    noon += Math.round((t - noon) / DAY_MS) * DAY_MS;                      // the one nearest t
    noon -= solar(noon).eot * 60000;                                       // true solar noon
    const s = solar(noon), lat = p.lat * D2R;
    let cosH = (Math.sin(DAWN_ALT * D2R) - Math.sin(lat) * Math.sin(s.decl)) / (Math.cos(lat) * Math.cos(s.decl));
    cosH = Math.min(Math.max(cosH, Math.cos(170 * D2R)), Math.cos(10 * D2R));   // polar summer and winter: stay readable
    const half = Math.acos(cosH) / (2 * Math.PI) * DAY_MS;
    return { noon, half };
  }

  // the current toki: which animal, its bell count, when it began and how long it lasts; the dial's boundary angles
  // (radians clockwise from noon at the top, starting at dawn six), the bead's angle, and the season
  function state(t, p) {
    const { noon, half } = sunDay(t, p);
    const H = half / DAY_MS * 2 * Math.PI, NIGHT_A = 2 * Math.PI - 2 * H;
    const B = [];
    for (let j = 0; j <= 6; j++) B.push(-H + j * (2 * H / 6));
    for (let j = 1; j <= 6; j++) B.push(H + j * (NIGHT_A / 6));
    const phi = (t - noon) / DAY_MS * 2 * Math.PI;                       // the bead: now, as the sun's hour angle
    const a = ((phi + H) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - H;
    let seg = 0;
    while (seg < 11 && a >= B[seg + 1]) seg++;
    const animal = seg < 6 ? DAY[seg] : NIGHT[seg - 6];
    const start = t - (a - B[seg]) / (2 * Math.PI) * DAY_MS;
    const len = (B[seg + 1] - B[seg]) / (2 * Math.PI) * DAY_MS;
    const lam = solar(t).lam, k = Math.floor(((lam - 315) % 360 + 360) % 360 / 15);
    return { seg, animal, count: BELLS[animal], start, len, bounds: B, bead: a, day: seg < 6,
             counts: DAY.concat(NIGHT).map(x => BELLS[x]), sekki: SEKKI[k], noon, half };
  }

  // visual bell state, seconds after the toki began (real seconds since the crossing was seen)
  function strokes(sec) {
    let sute = 0;
    for (const s of SUTE) sute = Math.max(sute, sec >= s ? Math.exp(-(sec - s) / 0.9) : 0);
    const lit = sec < COUNT0 ? 0 : (sec - COUNT0) / STEP + 1;              // fractional: the dot brightens as it rings
    return { sute, lit };
  }

  return { DAY, NIGHT, BELLS, SUTE, COUNT0, STEP, place, state, strokes, solar, sunDay };
})();

window.TOKI = TOKI;
