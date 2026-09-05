// Self-hosted variable webfaces for the portal shells.
//
// Replaces two render-blocking <link rel="stylesheet"> requests to
// api.fontshare.com. Those held first paint on every navigation — the shells
// have no client-side router, so each nav click paid a third-party round trip
// before anything painted, which is what users saw as a flash. Declaring the
// faces inline removes the blocking stylesheet entirely; the font binaries then
// load asynchronously and `font-display: swap` paints text in the fallback
// immediately.
//
// One variable file per family covers every weight the shells use (Instrument
// Sans 400-700, Geist Mono 400-500), replacing six static files.
//
// `src` lists two sources on purpose. The local path is the fast one and is
// what a portal should ship; the pinned jsDelivr URL keeps a portal that has
// not copied the files yet from dropping to system fonts. To add the local
// path, copy from node_modules/@fontsource-variable/<family>/files/ into
// public/fonts/ (devDependencies @fontsource-variable/instrument-sans and
// @fontsource-variable/geist-mono).
//
// Keep FONTSOURCE_VERSION in step with those devDependencies.

const FONTSOURCE_VERSION = "5.3.0";

const cdn = (family: string, file: string) =>
  `https://cdn.jsdelivr.net/npm/@fontsource-variable/${family}@${FONTSOURCE_VERSION}/files/${file}`;

const LATIN =
  "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";

// fr/es/pt reach into this range; en never loads it.
const LATIN_EXT =
  "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF";

interface Face {
  family: string;
  pkg: string;
  file: string;
  weight: string;
  range: string;
}

const FACES: Face[] = [
  {
    family: "Instrument Sans",
    pkg: "instrument-sans",
    file: "instrument-sans-latin-wght-normal.woff2",
    weight: "100 900",
    range: LATIN,
  },
  {
    family: "Instrument Sans",
    pkg: "instrument-sans",
    file: "instrument-sans-latin-ext-wght-normal.woff2",
    weight: "100 900",
    range: LATIN_EXT,
  },
  {
    family: "Geist Mono",
    pkg: "geist-mono",
    file: "geist-mono-latin-wght-normal.woff2",
    weight: "100 900",
    range: LATIN,
  },
  {
    family: "Geist Mono",
    pkg: "geist-mono",
    file: "geist-mono-latin-ext-wght-normal.woff2",
    weight: "100 900",
    range: LATIN_EXT,
  },
];

export const FONT_FACE_CSS = FACES.map(
  (f) => `@font-face{font-family:'${f.family}';font-style:normal;font-display:swap;font-weight:${f.weight};src:url('/fonts/${f.file}') format('woff2-variations'),url('${cdn(f.pkg, f.file)}') format('woff2-variations');unicode-range:${f.range};}`,
).join("");
