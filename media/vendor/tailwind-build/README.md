# Regenerating `../tailwind.min.css`

The vendored stylesheet is Tailwind CSS v3 purged down to a curated `safelist` (see
`tailwind.config.js` in this folder) instead of the full framework — the full unpurged build is
~2.9MB, too heavy to load into every generated panel's Shadow DOM. This safelist covers common
layout/spacing/color/typography/border utilities; it is not exhaustive.

To regenerate after editing the safelist:

```sh
cd media/vendor/tailwind-build
npm init -y >/dev/null 2>&1  # one-off scratch install, not part of the extension's own deps
npm install -D tailwindcss@3
npx tailwindcss -i input.css -o ../tailwind.min.css --minify
```

Then prepend a one-line `/* ... */` provenance comment back onto `../tailwind.min.css` (minifying
strips it) and delete the scratch `node_modules`/`package.json` this created before committing.
