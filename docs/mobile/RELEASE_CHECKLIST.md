# Native release checklist

Preparation evidence: [2026-11-03 release status](RELEASE_STATUS_20261103.md).
Store copy, privacy/billing gates and signing handoff: [store/REVIEW_HANDOFF.md](store/REVIEW_HANDOFF.md).
Until approval: [PWA installation](INSTALL_BEFORE_STORE_REVIEW.md).

Unchecked device/store gates remain required even when automated builds pass.

## Shared gate

- [ ] Exact source SHA and uncommitted changes recorded (current work is on `main` by explicit human instruction); web typecheck, lint, i18n, tests, build and diff-check pass.
- [ ] Additive migrations applied with `prisma migrate deploy`; no pending migrations and no `db push`.
- [ ] Production, Preview and development mobile base URLs validated.
- [ ] Native bundle scan contains no DB/Redis/provider/auth/signing secrets.
- [ ] Account creation/deletion and public deletion-request URL verified.
- [ ] Seller, App Privacy/Data safety, retention and subscription billing treatment confirmed.
- [ ] Review demo account/contact and content/age declarations completed.
- [ ] iOS required-reason manifest is included in the compiled archive.
- [ ] Web, PWA, desktop POS and mobile browser POS smoke pass.
- [ ] Login/logout/restart/user switch, org/store/register context and expired session pass.
- [ ] Offline/reconnect cannot report a failed server mutation as successful.
- [ ] Barcode found/not-found/duplicate/rapid/denied/unavailable pass through existing lookup/cart.
- [ ] Safe areas, status/navigation bars, keyboard, sheets, toasts and bottom navigation pass.
- [ ] PDFs, receipts, reports and spreadsheets open/share; web download fallback still passes.
- [ ] Custom links, universal/app links and unauthorized-link behavior pass.
- [ ] Notification rationale, register/disable, tap link and invalid-token cleanup pass.

## Android

- [ ] Debug APK installed on phone and tablet/emulator.
- [ ] Release AAB built and signed by protected release identity.
- [ ] Play App Signing fingerprint published in asset links.
- [ ] Firebase `google-services.json` injected by protected build environment.

## iOS

- [ ] Simulator and physical-device builds pass.
- [ ] Apple Team, provisioning, Push Notifications and Associated Domains enabled.
- [ ] APNs key configured server-side; AASA contains the real application identifier.
- [ ] Archive validates in App Store Connect and TestFlight smoke passes.

## Store copy

- Name: **Bazaar**
- Short description: **POS, товары, остатки, заказы и аналитика — одна система для магазина.**
- Support: `https://www.bazaar.kg/help`
- Privacy: `https://www.bazaar.kg/privacy`
- Release notes template: **Bazaar для iOS и Android: товары, продажи, складские операции и отчёты.**
- Screenshot capture matrix: login, dashboard, mobile POS/catalog, scanner permission/context, split payment, held receipt, products, receiving, orders, reports, Bazaar Guide. Select the allowed number per store/device class; capture real native UI with synthetic data and preserve provenance. Current browser candidates do not complete native-device verification.
