# Actual native page verification — 11 November 2026

This is an execution record, not complete release acceptance. The owner asked
the agent to inspect pages autonomously in iOS Simulator after finding missing
registration and the Baam popup in the first TestFlight build.

## Environment and evidence

- Owner: TestFlight `1.0.0 (111120)`, internal distribution, isolated Preview.
  The owner explicitly reported successful installation, sign-in to the working
  screen, product search with keyboard, and camera permission/live image.
  These are owner reports, not agent-observed barcode decoding or purchase tests.
- Agent: the existing arm64 iOS 26.5 Simulator staging bundle `111116`.
  All 43 native source inputs match the source of signed device build `111120`;
  the architecture and build number differ. No rebuild was needed for this UI
  pass. The agent operated the actual Simulator application, not a browser skin.
- Baseline website: `56c744aaa241d6abc8c585b997935440adf5e801` on the dedicated
  Preview, with synthetic data and external providers disabled. The main website
  and customer database were not changed.
- Private observations, screenshots and isolated database verification are under
  ignored `.local/ios-release-20261111/native-page-qa-20261111/`. They contain no
  public-release screenshots or evidence of production readiness.

## Direct observations before the fixes

| Flow | Observed result |
| --- | --- |
| Login and dashboard | Signed in with the synthetic demo owner; dashboard and bottom navigation rendered. |
| Registration and invitation entry | Preview explicitly returned `invite_only`, so login offered an access request rather than open signup. Registration/invitation screens lacked a visible return to login; a back gesture did not navigate. |
| Baam | Header icon opened the popup first. Its title overlapped the iOS status bar/notch. The extra full-page link reached the working Baam workspace. |
| Products | Catalog and icon row actions rendered. An ordinary name tap did not open the product card, preserving the requested workflow. Opening an overflow menu after scrolling displaced the sticky app header. |
| POS | Added one synthetic product at 120.50 KGS and completed one cash sale. The success screen and journal showed `S-000001`. A separate read-only database snapshot passed 7 checks: one completed sale, one line, one cash payment, one sale stock movement, stock 20 → 19, and no refund/fiscal provider record. No real payment was made. |
| Receipt journal | The full-screen dialog put its title and close control beneath the status bar; the close touch was blocked. Hardware Escape dismissed it. |
| Receiving | Selected product B, entered quantity 2 and cost `175,50` using the actual iOS decimal keyboard; the UI showed 351.00 KGS. Normal input focus scrolled above the keyboard; tapping the heading hid it and restored the actions. Canceled the draft without posting stock. |
| Transfers | Opened the form and both store selectors. The manual demo currently has one store; a completed two-store native transfer remains to be verified. |
| Write-offs | Native date picker opened and canceled correctly. The long stock/cost summary expanded the implicit mobile grid beyond the viewport and clipped the right side of both catalog and line sections. |

## Changes and bounded automated verification

- iOS Baam launcher navigates directly to the existing full workspace. The
  native Back control returns to a validated local originating page and retains
  its filters and explicit store context. Website/Android popup behavior remains.
- Registration and both invitation screens expose an existing localized login
  link, including loading and error states. This does not change signup policy,
  deliver an email, bypass verification, or enable production registration.
- A meaningful Baam regression exposed an existing draft restoration race:
  promoting a new server conversation could overwrite text typed during a
  pending send. The local promotion now preserves that text while ordinary
  cached drafts and failed outboxes still restore on initial open and remount.
- Focused Baam/auth checks: initial run 147/148 passed and exposed that race;
  the corrected run passed all 150 checks in 10 files. The failed run is retained.
- Native modal locking now keeps the document locked at the root while the body
  uses `overflow: clip`, preserving the viewport-sticky header. Full-height phone
  dialogs use the existing top safe area and reduced height. Ordinary sheets,
  wider inset dialogs, web and Android retain their existing geometry.
- The isolated offline layout regression passed 10 checks with installed
  Chromium. It reproduced the original lost header before applying the fix and
  verified page locking, inner scrolling, nested cleanup and dialog bounds.
  This fixture does not establish actual WKWebView behavior or full Radix focus.
- Final scoped regression: 16 mobile/dialog/workflow files, 75 checks passed;
  typecheck, lint and RU/KG/EN translation validation passed with unchanged source.
- The subsequent native warehouse pass exposed width overflow. Receiving and
  write-off grids now use an explicit shrinking mobile column, matching the
  transfer workflow; detail fields and cards can shrink and long validation
  text can wrap. The existing desktop 2fr/3fr columns and order are preserved.
  The 3 affected workflow/source suites passed all 18 checks, followed by clean
  typecheck, lint and translation validation. Updated native geometry remains
  to be rechecked after its own Preview build.

Production build, Preview deployment and actual updated runtime checks are
recorded when complete. A successful component test does not prove WKWebView
geometry or native keyboard behavior.

## Remaining verification

Continue the actual page pass after updating Preview: corrected Baam launch and
Back, scrolled menus and nested dialogs, reachable full-screen close controls,
auth return links, all relevant roles/stores, warehouse operations, reports,
files/share, profile/privacy, background/offline recovery and the remaining
routes. Preserve the established operational layouts.

Simulator checks complement the real iPhone and Apple Sandbox requirements.
They do not complete camera barcode, photo/file permissions, StoreKit purchases,
all paid catalog configuration, App Review, or publication. Those remain part of
the full release goal.
