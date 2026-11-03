# Screenshot preparation

`browser-candidates/` contains 14 actual screenshots of a local production build with synthetic store data: login, dashboard, products, inventory, orders, reports and help, each at phone 1242×2688 and tablet 2048×2732. No production customer data was used. Browser page errors were empty for the captured authenticated pages.

These are candidates for visual preparation, **not verified native screenshots**. No Capacitor runtime or OS permission sheet was fabricated. Capture/compare the signed native release before submission, including POS, scanning, receiving, offline recovery, keyboard and sharing. The JSON provenance records the local origin and marks submission readiness false. Use native Android captures for the Play phone/tablet sets; do not relabel the browser/iPad dimensions as tested Android hardware.

Capture scripts and database were disposable. The temporary server and database were stopped and removed after capture because the Mac ran out of disk space. Build logs and binary outputs remain in ignored `artifacts/mobile-release-20261103/`.

Field text uses Russian here. Store listing and feature graphics also include English and Kyrgyz; localized native screenshots remain a release task.
