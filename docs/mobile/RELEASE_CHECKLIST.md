# Native release checklist

## Shared gate

- [ ] Exact `main` SHA recorded; web typecheck, lint, i18n, tests, build and diff-check pass.
- [ ] Additive migrations applied with `prisma migrate deploy`; no pending migrations and no `db push`.
- [ ] Production, Preview and development mobile base URLs validated.
- [ ] Native bundle scan contains no DB/Redis/provider/auth/signing secrets.
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
- Release notes template: **Bazaar для iOS и Android: мобильная касса, сканирование штрихкодов, безопасные уведомления, ссылки и системный обмен документами.**
- Required screenshots: login, dashboard, mobile POS/catalog, scanner permission/context, split payment, held receipt, products, receiving, orders, reports, Bazaar Guide.
