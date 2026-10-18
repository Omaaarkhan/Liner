# App icon

`groove.svg` is the master artwork. Regenerate the platform icons with:

```bash
npx electron scripts/make-icons.cjs
```

That writes `build/icon.icns` (macOS, masked to the Big Sur/Tahoe grid), `build/icon.ico` (Windows) and `build/icon.png` (Linux, 1024 px). It renders with Electron, so nothing else is needed except `iconutil` (built into macOS) for the `.icns`.
