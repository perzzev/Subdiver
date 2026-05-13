# Subdiver

Subdiver is a small open-source subtitle study app for learning Dutch. It turns VTT/SRT subtitles into a readable timed transcript, lets you click words or select phrases, and asks the OpenAI Responses API for contextual explanations.

The app is client-only: it runs in the browser, stores settings locally, and calls OpenAI directly from the page.

## Features

- Bundled sample catalog with Zuidas season 1 subtitles.
- Upload your own `.vtt` or `.srt` subtitles.
- Click a word for translation in sentence context.
- Select a phrase or sentence for a full contextual translation.
- Ask follow-up questions about grammar, usage, or nuance.
- Resume the last transcript and last viewed cue after reopening.
- Choose an OpenAI model from the API once your key is configured.

## Requirements

- Node.js 24+
- npm
- An OpenAI API key

## Run Locally

```bash
npm install
npm run dev
```

Open the printed local URL, usually:

```text
http://127.0.0.1:5173/
```

## Use The App

1. Open Settings with the gear button.
2. Enter your OpenAI API key. If you have not created one before, this walkthrough is a useful reference: https://www.youtube.com/watch?v=SzPE_AE0eEo
3. Click "Load models" to fetch text-capable models available to your account, then choose one or type a model manually.
4. Set the target language, for example `Russian` or `English`.
5. Start from a bundled sample episode or upload your own subtitle file.
6. Click a word to translate it in subtitle context.
7. Select a phrase or sentence to translate the selection.
8. Use "Ask follow-up" for extra questions.

## Build

```bash
npm run build
```

Preview the production build:

```bash
npm run preview
```

## Test

```bash
npm test
```

## GitHub Pages

The Vite config sets the production base path from `GITHUB_REPOSITORY`, so the GitHub Actions workflow can deploy the app under a repository subpath automatically.

After pushing to GitHub:

1. Enable GitHub Pages for the repository.
2. Set the Pages source to GitHub Actions.
3. Push to `main`.

## Local Storage

Subdiver stores these locally in your browser:

- OpenAI API key and settings in `localStorage`, if enabled.
- Last transcript, including uploaded subtitle text, in IndexedDB.
- Last viewed cue in `localStorage`.
- Lookup cache in IndexedDB.

Use Settings -> "Clear lookup cache" to clear cached translations.

## Sample Content Notice

Subdiver is released under the MIT license. The bundled Zuidas subtitle files are included as educational fixtures for testing and language learning. Those subtitle samples remain owned by their respective rights holders and are not covered by the MIT license for the app code.

## Important Caveat

This app is meant to run as its own page. It is not injected into NPO or other video websites.

Direct OpenAI API requests work from the app page. Running the same code inside another website can fail because that site may set a Content Security Policy that blocks requests to `api.openai.com`.
