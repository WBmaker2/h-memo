# H Memo

H Memo is a local-first sticky memo app. The first target is a Windows desktop app built with Tauri 2, React, and TypeScript. Shared memo logic lives in packages so a future web/PWA version can reuse the same model and UI.

## Development

```bash
npm install
npm run dev
```

## Checks

```bash
npm run typecheck
npm test
npm run build
```

## Desktop

```bash
npm run tauri:dev
npm run tauri:build
```

Windows installer artifacts are produced through the Tauri bundle step. Final Windows smoke testing must happen on Windows or a Windows CI runner.
