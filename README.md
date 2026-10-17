# SoundLeaf

SoundLeaf is a browser-based EPUB-to-audiobook studio. It parses EPUB files locally and uses the reader's own official Gemini API key to create downloadable, chapter-based WAV audiobooks.

## Features

- Parses EPUB metadata, reading order, chapters, and body text locally
- Lets readers select chapters and preview extracted text before generation
- Uses the official Gemini TTS API with Flash and Flash-Lite model options
- Supports Gemini voices and controllable reading-style instructions
- Automatically splits long chapters into API-friendly segments
- Preserves the EPUB's original chapter boundaries and emits one WAV file per chapter
- Generates chapters sequentially with live progress and cancellation
- Automatically waits and retries when the Gemini free-tier rate limit is reached
- Provides in-browser playback and individual WAV downloads
- Packages all completed chapters into a ZIP archive
- Keeps the API key in `sessionStorage` only, so it is cleared when the tab closes
- Works on desktop and mobile and deploys directly to GitHub Pages

## Use the hosted app

Open [SoundLeaf on GitHub Pages](https://choppa129.github.io/epub-audiobook-studio/).

1. Choose or drop an EPUB file.
2. Review the detected chapters and select what you want to generate.
3. Enter your Gemini API key and confirm the model and voice.
4. Optionally provide reading-style instructions.
5. Generate the selected chapters, preview the audio, and download WAV files or a ZIP archive.

## Run locally

Because the app loads browser modules and processes local files, serve the project through a local static server instead of opening `index.html` directly:

```bash
npx serve .
```

Then open the local address shown in your terminal.

## Deploy with GitHub Pages

The repository includes a GitHub Pages workflow. Push to `main`, then choose **GitHub Actions** under **Settings → Pages → Build and deployment**.

## Privacy and security

- The EPUB is read locally in the browser and is never uploaded to this project's server.
- Text from selected chapters is sent directly from the browser to the official Gemini API.
- The API key is not committed, logged, or stored permanently by SoundLeaf.
- Since this is a static site, every reader must provide their own API key.

## Current limitations

- The first release exports chapter WAV files and a ZIP archive. MP3 and M4B export are planned for a later release.
- EPUB formatting varies widely, so complex books may need additional cleanup rules.
- Long chapters are split for generation, then their PCM data is merged into a valid WAV file in the browser.
- Splitting respects Gemini's 8,192-token input and 16,384-token output limits, using conservative token and spoken-duration estimates because characters do not map to tokens equally across languages.
- Free-tier generation can be slow because Gemini may allow only a few TTS requests per rate-limit window. SoundLeaf follows the API's requested retry delay automatically.

Use SoundLeaf only with books and other content you own or are authorized to convert.

## License

[MIT](LICENSE)
