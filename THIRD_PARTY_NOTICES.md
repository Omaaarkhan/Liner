# Third-party software

The app's own source code is MIT licensed (see `LICENSE`). Release builds also ship these separate programs, which keep their own licenses. They run as separate processes; the app does not link against them.

| Program | Where it comes from | License |
| --- | --- | --- |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | Official release builds, downloaded by `apps/desktop/scripts/prepare-binaries.mjs` and updated in the app | Unlicense (public domain). The bundled Python runtime and libraries carry their own permissive licenses, listed inside the yt-dlp folder. |
| [FFmpeg](https://ffmpeg.org) | Static builds from the [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static) npm package | GPL-3.0-or-later for these builds. Source code for FFmpeg is available at https://ffmpeg.org/download.html and the build scripts are linked from the ffmpeg-static repository. |
| [Electron](https://www.electronjs.org) | npm | MIT, plus the Chromium licenses shown in the app's `LICENSES.chromium.html` |

Metadata comes from the [MusicBrainz](https://musicbrainz.org) web service and cover images from the [Cover Art Archive](https://coverartarchive.org). Please respect their [rate limits and terms](https://musicbrainz.org/doc/MusicBrainz_API).
