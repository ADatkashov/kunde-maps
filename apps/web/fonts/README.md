# Self-hosted map glyphs

Signed-distance-field glyph PBFs for the label fonts used by the map styles (`Open Sans Regular|Semibold|Italic|Bold`), so the
page no longer contacts a third-party host. They are the pre-built stacks published by the OpenMapTiles project
(https://github.com/openmaptiles/fonts, built from Open Sans; fonts there are under OFL/Apache-2.0 - see the upstream LICENSE).

Ranges: 0-1535 (Latin, Latin Extended, IPA/diacritics, Greek, Cyrillic incl. Kazakh letters ә ғ қ ң ө ұ ү һ і), 7680-7935 (Latin Extended
Additional), 8192-8703 (general punctuation, currency, letterlike). Characters outside these ranges render without a glyph (as before
for fonts lacking them). `CHECKSUMS.sha256` is verified in CI by `scripts/ci/check-vendor.py`.
