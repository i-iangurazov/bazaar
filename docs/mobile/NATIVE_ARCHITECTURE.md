# Native architecture

## Decision

Bazaar uses a remote-hosted Capacitor shell:

```text
Android / iOS WebView
  -> HTTPS https://www.bazaar.kg
  -> existing Next.js App Router, NextAuth cookies, tRPC/routes
  -> existing Vercel backend, PostgreSQL, Redis and providers
```

The application is dynamic SSR with authenticated server routes and database-backed workflows, so `next export` would remove required behavior. The small bundled `mobile-shell` is only startup/offline fallback. There is no native backend and no duplicate POS, inventory, order, or pricing logic.

## Authentication and identity

The system keeps NextAuth JWT-cookie sessions inside the OS WebView cookie store. Login, logout, expiry, organization context, store/register preferences, and user switching therefore use the same server authority as Web/PWA. Push tokens are AES-GCM encrypted server-side and scoped to the authenticated user and organization. Logout disables the current installation before ending the session. No password or privileged token is stored in localStorage or native configuration.

## Native boundary

Capacitor calls are isolated in `src/lib/native/*`; web fallbacks preserve existing behavior. The runtime is SSR-safe and activates only after `Capacitor.isNativePlatform()` is true. Scanner output enters the existing barcode/product lookup. Share/file handling enters existing PDF/export flows. Backend authorization still protects every deep-linked route.

## PWA and updates

The web PWA remains unchanged. In a native runtime, Bazaar does not register the PWA service worker, unregisters prior registrations, and removes only Bazaar static-asset caches. It does not clear cart, session, user, store, or register state. The hosted UI therefore tracks the deployed backend instead of running stale cached code.

`/api/mobile/config` publishes `minimumSupportedAppVersion` and `latestAppVersion`. Older compatible clients continue working through backward-compatible APIs; a version below the minimum gets a controlled update screen.

## Push and links

`MobileDevice` is an additive, tenant-scoped device-registration model. FCM HTTP v1 and APNs provider code runs server-side in `disabled`, `mock`, or `live` mode. Provider credentials never ship in the app. Invalid provider tokens are disabled.

Custom links (`bazaar://...`) and verified `https://www.bazaar.kg/...` links are allowlisted and mapped to normal Bazaar routes. Apple AASA and Android asset-links endpoints reveal only public team/certificate identifiers. Final association verification requires the release signing identities.

## Audited existing architecture

- Next.js 14.2 App Router, dynamic SSR and standalone server output.
- NextAuth JWT-cookie sessions and server-side organization/role/store authorization.
- tRPC and route handlers on Vercel; Prisma/PostgreSQL and Redis remain server-only.
- Existing PWA manifest/service worker, responsive app shell, mobile POS and browser scanner.
- Existing browser PDF/export/printing flows remain the web fallback.
