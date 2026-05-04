# PWA Installation Plan

## Current State

- App metadata lived in `src/app/layout.tsx` with localized title/description and basic icon links to `public/brand/icon.png`.
- `public/` only contained `brand/icon.png` and `brand/logo.png`; there was no web app manifest, apple touch icon, or maskable launcher icon set.
- There was no service worker registration or offline fallback.
- The authenticated AppShell header already had a compact action cluster: page tips and language switcher. This is the correct place for a small install affordance without changing the app layout.

## Platform Behavior

- Chromium browsers expose `beforeinstallprompt` for eligible PWAs. The event is non-standard and should be used only after it fires; the app stores the event and calls `prompt()` from the user click.
- iOS Safari does not expose the same automatic install prompt. Users install from Share -> Add to Home Screen, so Bazaar must show instructions instead of pretending it can open a native prompt.
- In-app browsers are inconsistent and often block PWA install flows. Bazaar should guide users to Safari or Chrome.
- Installed mode can be detected with `matchMedia("(display-mode: standalone)")`; iOS also supports `navigator.standalone`.
- Production installability requires HTTPS. Localhost is acceptable for local testing.

References used:

- MDN, triggering a PWA install prompt: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/How_to/Trigger_install_prompt
- MDN, manifest icons and maskable purpose: https://developer.mozilla.org/docs/Web/Progressive_web_apps/Manifest/Reference/icons
- MDN, standalone display mode: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/How_to/Create_a_standalone_app
- web.dev, service worker caching considerations: https://web.dev/learn/pwa/caching
- Apple Safari web app metadata: https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html

## Implementation

- Added `public/manifest.webmanifest` with `name`, `short_name`, `start_url`, `scope`, `display: standalone`, theme/background colors, launcher icons, maskable icons, and shortcuts for Dashboard, POS, Products, and Inventory.
- Generated PWA icon assets from the original Bazaar mark on a plain white square background:
  - `public/icons/icon-192.png`
  - `public/icons/icon-512.png`
  - `public/icons/maskable-192.png`
  - `public/icons/maskable-512.png`
  - `public/apple-touch-icon.png`
- Updated Next.js metadata with manifest, apple web app metadata, apple touch icon, launcher icons, and theme color.
- Added `public/sw.js` with conservative caching:
  - precaches only static shell-safe files and icons;
  - uses network-first navigation with `/offline.html` fallback;
  - avoids `/api`, auth, login/signup/reset/invite/verify, and `/_next/data` responses;
  - does not cache private user data or dynamic dashboard/POS/inventory responses.
- Added `public/offline.html` with concise English/Russian/Kyrgyz offline copy.
- Added `src/hooks/usePwaInstall.ts` for install prompt capture, standalone detection, iOS detection, in-app browser detection, secure-context detection, and `promptInstall()`.
- Added `src/components/pwa-install-button.tsx` as a small secondary header action between tips and the language switcher.
- Added `src/components/pwa-service-worker-register.tsx` and mounted it through app providers.

## UX Rules

- The install button is hidden when Bazaar is already installed.
- Chromium/Android/Desktop: clicking the button uses the saved `beforeinstallprompt` event when available.
- iOS Safari: clicking opens a concise Add to Home Screen instruction modal.
- Unsupported/in-app browser: clicking opens guidance to use Chrome or Safari.
- If the browser has not exposed the prompt yet, Bazaar shows browser install guidance instead of failing silently.

## Limitations

- This is not native Android/iOS app parity. Browser capabilities still control install prompts, background behavior, and offline limits.
- Offline mode is intentionally minimal. POS, inventory, orders, and auth require network access and are not cached as if they were offline-capable.
- The current app icon uses the existing Bazaar mark with a white launcher background. Final app-store-grade icon polish still needs design approval.
