# SoundLeaf

SoundLeaf is a browser-based EPUB-to-audiobook studio. It parses EPUB files locally and uses the reader's own OpenAI-compatible text-to-speech API key to create downloadable, chapter-based MP3 audiobooks.

## Features

- Parses EPUB metadata, reading order, chapters, and body text locally
- Lets readers select chapters and preview extracted text before generation
- Supports a custom API endpoint, model, voice, and reading instructions
- Automatically splits long chapters into API-friendly segments
- Generates chapters sequentially with live progress and cancellation
- Provides in-browser playback and individual MP3 downloads
- Packages all completed chapters into a ZIP archive
- Keeps the API key in `sessionStorage` only, so it is cleared when the tab closes
- Works on desktop and mobile and deploys directly to GitHub Pages

## Use the hosted app

Open [SoundLeaf on GitHub Pages](https://choppa129.github.io/epub-audiobook-studio/).

1. Choose or drop an EPUB file.
2. Review the detected chapters and select what you want to generate.
3. Enter your text-to-speech API key and confirm the endpoint, model, and voice.
4. Optionally provide reading-style instructions.
5. Generate the selected chapters, preview the audio, and download MP3s or a ZIP archive.

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
- Text from selected chapters is sent directly to the TTS provider configured by the reader.
- The API key is not committed, logged, or stored permanently by SoundLeaf.
- Since this is a static site, every reader must provide their own API key.

## Current limitations

- The first release exports chapter MP3s and a ZIP archive. M4B export with embedded chapter metadata is planned for a later release.
- EPUB formatting varies widely, so complex books may need additional cleanup rules.
- Generated MP3 parts are concatenated in chapter order; provider-specific encoding differences may affect seeking in some players.

Use SoundLeaf only with books and other content you own or are authorized to convert.

## License

[MIT](LICENSE)
