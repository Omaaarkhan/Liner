# YouTube Audio Ripper

Electron + React desktop app for extracting high-quality audio from YouTube, enriching metadata, and writing tagged files into a structured music library.

## Packages

- `apps/desktop`: Electron main/preload + React renderer UI.
- `packages/shared`: Shared types and interfaces.
- `packages/core`: Extraction, metadata, tagging, and library pipeline.
- `packages/tests`: Unit and integration tests.

## Quick start

1. Install dependencies: `npm install`
2. Start dev app: `npm run dev`
3. Run tests: `npm run test`
4. Build app: `npm run build`
5. Package macOS app: `npm run package:mac -w apps/desktop`

## External dependencies

The installer now bundles:

- `ffmpeg`
- `ffprobe`
- `yt-dlp`

Manual install is optional and only needed as a fallback:

```bash
brew install ffmpeg yt-dlp
```

## Implemented capabilities

- Single YouTube URL extraction with `yt-dlp --dump-single-json`.
- Highest-quality audio format selection (audio-only preferred).
- Source-fidelity output by default, with optional MP3 320 export mode.
- Metadata enrichment via YouTube parsing + MusicBrainz lookup.
- Ambiguous metadata pauses the job and requires manual selection in UI.
- Tag writing and artwork embedding through `ffmpeg`.
- Library organization under `Artist/Album/NN - Title.ext`.
- Queue/history persistence in JSON under Electron `userData`.
