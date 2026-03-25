# YouTube Audio Ripper

YouTube Audio Ripper is a macOS-first Electron desktop app for downloading a single YouTube video as high-fidelity audio or MP4 video, enriching audio metadata, embedding artwork, and organizing the result into a local library.

The app currently targets single-video URLs only. Playlist, channel, and batch workflows are out of scope for this version.

## Features

- `source_fidelity` audio mode preserves the best available source audio format whenever possible.
- `mp3_320_export` audio mode transcodes output to MP3 320 kbps for compatibility.
- `video_mp4` mode downloads video and saves it as MP4.
- Metadata lookup combines YouTube title parsing with MusicBrainz candidate search.
- Artwork comes from Cover Art Archive when available, with YouTube thumbnail fallback and manual artwork replacement in the UI.
- Low-confidence metadata pauses the job for manual review instead of silently committing tags.
- Queue/history supports delete, clear history, and `Show in Finder` for completed jobs.
- Light and dark themes are built into the desktop UI.

## Repo Layout

- `apps/desktop`: Electron main/preload code, React renderer, packaging config, app assets.
- `packages/core`: Download orchestration, metadata resolution, tagging, library placement, persistence.
- `packages/shared`: Shared TypeScript types and contracts.
- `packages/tests`: Vitest coverage for parser and library-placement logic.

## Requirements

- Node.js `>= 20`
- npm
- Network access during setup/build so the desktop app can fetch the bundled `yt-dlp` binary

You do not normally need to install `ffmpeg`, `ffprobe`, or `yt-dlp` yourself. The desktop app prepares and bundles them during build/package flows.

## Install And Run

```bash
npm install
npm run dev
```

`npm run dev` starts the Vite renderer, TypeScript watch for the Electron main process, and launches Electron once the renderer is ready.

On first build-oriented runs, the desktop app prepares bundled binaries under `apps/desktop/vendor/bin/<platform>-<arch>`.

## Available Scripts

```bash
npm run dev
npm run test
npm run lint
npm run build
npm run package:mac
```

- `npm run test`: runs the Vitest suite in `packages/tests`
- `npm run lint`: runs TypeScript no-emit checks for the desktop app
- `npm run build`: builds shared, core, and desktop packages
- `npm run package:mac`: creates macOS release artifacts in `apps/desktop/release/`

## Packaging

macOS packaging is currently configured in `apps/desktop/electron-builder.yml`.

Current outputs:

- `.dmg`
- `.zip`

The packaged app includes bundled binaries through Electron Builder `extraResources`.

macOS code signing and notarization are not configured in this repo. Packaged builds are unsigned unless you add signing credentials separately.

## How To Use

1. Launch the app.
2. Pick an output root and quality mode in Settings.
3. Optionally choose a speed profile, metadata confidence threshold, and artwork preference.
4. Paste a single YouTube URL into the home panel.
5. Click the analyze/download button.
6. For audio jobs, review metadata candidates, edit fields or artwork if needed, then apply metadata.
7. For video jobs, the app downloads MP4 output without audio metadata tagging.
8. Use Queue & History to inspect logs, reveal completed files in Finder, delete entries, or clear the full history.

## Download Modes

- `source_fidelity`: downloads the best available audio stream and avoids lossy re-encoding by default
- `mp3_320_export`: exports MP3 CBR 320 kbps
- `video_mp4`: downloads video and writes MP4 output

## Output Layout

Default output root:

```text
~/Downloads/YouTube Audio Ripper
```

File placement:

- Audio: `OutputRoot/Artist/Album/NN - Title.ext`
- Video: `OutputRoot/Videos/<Video Title>.mp4`

Settings and queue/history data are stored in the app's Electron `userData` directory.

## Bundled Binaries And Overrides

The desktop app prepares and uses these tools:

- `ffmpeg`
- `ffprobe`
- `yt-dlp`

You can override the resolved binary paths with environment variables:

```bash
YAR_FFMPEG_PATH=/custom/path/to/ffmpeg
YAR_FFPROBE_PATH=/custom/path/to/ffprobe
YAR_YTDLP_PATH=/custom/path/to/yt-dlp
```

The app also exposes a preflight check in the UI so you can verify binary availability and versions.

If you prefer system-installed tools as a fallback, you can still install them manually:

```bash
brew install ffmpeg yt-dlp
```

## Metadata And Artwork

- MusicBrainz recording search is used to build metadata candidates.
- Cover art is fetched from Cover Art Archive when a MusicBrainz release is available.
- The YouTube thumbnail is used as fallback artwork when better release art is unavailable.
- Artwork embedding is audio-only.
- `video_mp4` jobs skip audio metadata tagging and artwork embedding.

## Current Limitations

- Single-video URLs only
- macOS packaging is implemented; other release targets are not configured here
- Some YouTube videos may require extractor fallback behavior depending on current `yt-dlp` support
- Automated tests do not currently cover full desktop end-to-end flows

## Redistribution Note

This project bundles third-party binaries during build and packaging. Review the licenses and redistribution obligations for those binaries before shipping public installers.

## Legal Notice

You are responsible for complying with YouTube's terms of service, content-owner rights, and any applicable copyright law when using this app.
