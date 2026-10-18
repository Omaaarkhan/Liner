# Contributing

Thanks for helping. Bug reports, fixes and small features are all welcome.

## Set up

You need Node.js 20 or newer.

```bash
npm install
npm run dev        # the full app, with Electron, yt-dlp and ffmpeg
npm run dev:ui     # just the interface in a browser, with sample data
```

`npm run dev:ui` needs no Electron, yt-dlp or network, so it's the quickest way to work on the interface. Add `?platform=win32` to the URL to see the Windows layout.

## Before opening a pull request

```bash
npm run lint
npm test
```

CI runs the same checks on macOS, Windows and Linux. For interface changes, add before and after screenshots in light and dark mode.

## How the code is organised

- `packages/shared`: types shared by every part of the app.
- `packages/core`: the download pipeline. It runs yt-dlp and ffmpeg, matches tags on MusicBrainz, writes files into the library, and keeps history.
- `apps/desktop/electron`: the Electron main process (window, menus, IPC) and the preload bridge.
- `apps/desktop/src`: the React interface. `lib/useRipper.ts` holds the state; `components/` holds the views.
- `packages/tests`: Vitest tests for the core.

## Ground rules

- Test fixtures and screenshots use made-up artists and songs, never real commercial recordings.
- Keep features to things that help people download and organise media they have the right to save.
- Be kind. See `CODE_OF_CONDUCT.md`.
