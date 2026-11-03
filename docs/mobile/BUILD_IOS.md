# iOS build

## Identity

- Bundle ID: `kg.bazaar.app`
- Marketing version/build: `1.0.0` / `1` (check the next unused build in App Store Connect)
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

Camera permission is requested only when scanning, with English, Russian and Kyrgyz system descriptions. Notification permission follows an in-app explanation. App Store export-compliance metadata declares no non-exempt bundled encryption; confirm this against the final binary and service before submission.

Use `pnpm mobile:release ios unsigned` for a Release archive rehearsal and `pnpm mobile:release ios signed` with installed certificates/profiles and `APPLE_TEAM_ID` for archive plus local App Store export. Both require full Xcode with iOS SDK 26+. Neither uploads. See [store handoff](store/REVIEW_HANDOFF.md) for remaining review gates. The app resource manifest declares Filesystem timestamp use; App Privacy answers still need a separate complete service data review.
