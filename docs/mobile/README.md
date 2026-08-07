# Bazaar native applications

Bazaar ships one Next.js product through Web, PWA, Android, and iOS. The native projects are Capacitor shells; they do not contain a second frontend or backend.

## Developer commands

```bash
pnpm mobile:validate
pnpm mobile:assets
pnpm mobile:sync
pnpm mobile:android
pnpm mobile:ios
pnpm mobile:test
pnpm mobile:build:android
pnpm mobile:build:ios
```

Capacitor 8 requires Node 22. Android builds require JDK 21 and Android SDK 36. iOS builds require current full Xcode on macOS.

## Environments

`BAZAAR_MOBILE_ENV` is `development`, `staging`, or `production`. Development/staging may set `CAPACITOR_SERVER_URL`; production is fail-closed to the protected Bazaar shell at `https://www.bazaar.kg/dashboard`. Logged-out users are redirected through the existing login flow, while an existing WebView session opens Dashboard directly. `MOBILE_APP_VERSION` is appended to the WebView user agent. No server secret may enter `capacitor.config.ts` or either native bundle.

The native runtime uses existing Bazaar cookie authentication and APIs. It adds scanner, haptics, network state, app/universal links, native share/files, push registration, keyboard, status-bar, safe-area, splash, and compatibility-version handling under `src/lib/native` and `src/components/native`.

See the platform build guides and [release checklist](./RELEASE_CHECKLIST.md).
