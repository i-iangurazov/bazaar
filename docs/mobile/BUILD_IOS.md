# iOS build

## Identity

- Bundle ID: `kg.bazaar.app`
- Marketing version/build: `1.0` / `1`
- Deployment target: iOS 15
- Associated domain: `applinks:www.bazaar.kg`

## Simulator build

Install full current Xcode and Node 22, then:

```bash
BAZAAR_MOBILE_ENV=production pnpm mobile:sync
pnpm mobile:build:ios
```

## Device/archive

In Xcode select the Bazaar Apple Developer Team, preserve `kg.bazaar.app`, enable Push Notifications and Associated Domains, then archive the `App` scheme. Certificates, provisioning profiles and APNs `.p8` keys remain outside Git.

Server release configuration needs `APPLE_TEAM_ID` for AASA and APNs `TEAM_ID`, `KEY_ID`, private key and bundle ID. Verify `https://www.bazaar.kg/.well-known/apple-app-site-association` after setting the real team ID.

Camera permission is requested only when scanning. Notification permission follows an in-app explanation. App Store export-compliance metadata declares no non-exempt bundled encryption.
