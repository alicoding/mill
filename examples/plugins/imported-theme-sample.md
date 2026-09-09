# Imported theme sample

This is a data-only extension with no `main.js`. Its `source.json` is the
unchanged Catppuccin Latte color-theme file published in `@catppuccin/vscode`
3.18.1. Its SHA-256 is
`c5739194f3d416a0056f507e016c369c1919ca77c2ae93709aaff64deffdf771`.
The upstream MIT license and copyright notice are included below, and the
download provenance is preserved with the theme import fixtures under
`internal/services/pluginsvc/testdata/theme-import/`.

`theme.css` and `theme-import.json` show the output of Mill's version 1 theme
mapper. The source has 564 interface color keys; the mapper uses 14 unique
source keys. The remaining colors keep Mill's built-in light-theme values, and
syntax highlighting is not imported.

## Try it

To exercise the original-file path, open **Extensions**, choose **Import
theme**, and select this example folder's unchanged `source.json`. Review the
compatibility report, import it, then Allow the new data-only extension. The
theme appears in **Settings > Appearance**. Remove the imported extension
before importing the same file and appearance again.

## Upstream license

MIT License

Copyright (c) 2021 Catppuccin

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
