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

## Updated runtime checks — 12 November 2026

The immutable `9f221b8f4f37297d619bed2278f1c6c5f7233c06` Preview passed
`pnpm build`/`next build`, including compilation and all 133 static pages. Its
dedicated alias was verified against deployment
`dpl_4NFgvQ1do8DqNFUAaWv1a3Hwvssy`. The owner’s installed staging app can load
these hosted UI changes after a full restart; no replacement IPA was uploaded.

The agent rechecked the actual Simulator application after restarting it:

- One Baam icon tap opens the full workspace; Back returns to the originating
  dashboard. An unsent numeric draft survived leaving and reopening Baam. It was
  then cleared without sending a request.
- A product overflow menu opened after scrolling while the app header stayed in
  place. Closing it restored normal navigation.
- The completed sale appeared in history. Its full-height detail surface and
  close control sat below the status bar; a touch closed it successfully.
  This is separate from the exact inline POS receipt-journal instance, which
  still needs its own post-fix observation.
- Write-off catalog and line sections now fit the screen; the complete reason
  warning is visible. The native date control background still reaches the card
  edge; that narrower appearance issue is not claimed fixed.
- The counts list, dismissible introduction, new-count dialog and Cancel worked.
  No count was created or posted. Profile data, preferences and privacy controls
  were reachable by scrolling.
- Normal sign-out returned to login. The invite-only registration form rendered
  in RU/KG/EN; its new login link returned to the working login page. Invitation
  entry showed its validation error and retained a usable return link.

The native More menu also exposed a browser-PWA installation card inside the
already installed app. Its install button now uses the existing hydrated native
platform detection: icon/card/guidance stay hidden in iOS/Android while web
installation remains available. Three scoped suites passed 18 checks (including
native hiding and the real web prompt callback), followed by typecheck, lint and
translation validation. Those UI-only tests explicitly disabled DB execution;
actual native visibility still needs its new Preview deployment.

The later `fca36cf7` native pass reached the bottom of More with the language
switcher and sign-out control visible. The browser-install card was absent,
confirming the native hiding change in the actual app.

The account-deletion check exposed another real defect: a tall default size-md
dialog can still put its title/close under the notch. It was dismissed without
entering confirmation or deleting the account. The additional native centered
dialog height constraint passed all 14 extended offline layout checks, including
safe form/Cancel bounds at widths 393 and 320, followed by typecheck, lint and
translation validation. Its new production build and actual native confirmation
remain to be observed.

### Software-keyboard follow-up

The `7c3c74ae` deployment was subsequently observed in the actual Simulator.
The account-deletion title and close control were below the notch and the close
touch worked. With the Simulator hardware keyboard disconnected, however, the
real iOS software keyboard obscured the focused confirmation field and Cancel.
The same keyboard also covered the full-page Baam composer. The first keyboard
tutorial was dismissed and normal refocusing reproduced both defects. An unsent
synthetic `Q` draft was entered; no AI request or account deletion was submitted.

The follow-up fixes keep the configured Capacitor body-resize behavior. A shared
iOS coordinator combines the native keyboard height with the layout and visual
viewports without subtracting the keyboard twice. Native dialogs fit the visible
rectangle and reveal a focused control through its existing inner scroller.
The account-deletion description remains intact inside that scrollable form,
while the title and close control stay outside it. Full-page iOS Baam uses the
same visible-height contract: conversation controls/history scroll separately
from its composer, retaining drafts and reader position. Web and Android keep
their existing chat geometry.

Before deployment, 12 focused suites passed all 124 checks, including actual
runtime show/hide listener behavior, viewport cleanup, focused-control scrolling,
Baam history/draft preservation, voice and AI consent. The extended offline
layout fixture passed 19 checks, reproducing the prior keyboard occlusion and
checking automatic field/Cancel reveal, body-only and already-resized viewports,
hide recovery and full-screen/bottom-sheet bounds. Typecheck, lint and RU/KG/EN
translation validation passed. These UI-only suites explicitly disabled database
execution. The matching cloud production build and actual software-keyboard
recheck are still required before claiming these keyboard defects resolved.

That build subsequently passed: immutable `fca36cf7362ad73529d7fb15fb74f902205c7c4c`,
deployment `dpl_42AMZwhmLpVQP3LzqvH6BAqRzGWL`, compiled in 39.7 seconds and
generated all 133 static pages. Its dedicated Preview alias was verified, then
the actual app was fully restarted. In portrait with the hardware keyboard
disconnected, Baam's real iOS keyboard left the focused input, Send and voice
notice visible. A synthetic `Q` survived rotation and was cleared without sending.
The account-deletion title/close and focused confirmation field also remained
above the real software keyboard; no password, valid confirmation, ownership
transfer or deletion was submitted. This does not establish an actual touch
scroll to Cancel while that keyboard remains open.

The same actual Baam check exposed a landscape failure: the desktop-width shell
and non-scrolling page header left only a clipped composer strip. A subsequent
bounded change uses the measured short workspace height to move title/Back into
the native scrollport and put the existing 44px input/actions in a compact row.
The voice notice remains in the scrollable content. Five focused suites passed
106 checks, including focused draft preservation across short/normal mode,
history, failed-request retry and voice/consent behavior. Its cloud build and
actual landscape recheck remain pending.

The report hub showed the synthetic sale's 120.50 KGS revenue and 80.00 KGS cost.
Today correctly changed to zero after the Bishkek business-date boundary. Both
native date calendars independently opened the correct month/selected date and
closed without changing the period. Their gray field surfaces still exceed the
intended spacing; this is recorded separately from correct filtering behavior.
The current-stock report rendered three synthetic products and its CSV opened
the real system Share sheet (772 bytes). Cancelling returned to the report. A
source audit separately found that this cancellation also takes the browser
fallback-download branch; no second visible download prompt was observed.

The cancellation change distinguishes a dismissed native Share sheet from an
unavailable plugin, a preparation/share failure, a successful share and a stale
export audience. Cancellation is terminal and quiet, cleans the prepared cache
file and does not invoke a browser download or a print-fallback notice. Existing
failure/unavailable fallback behavior is retained and is not claimed repaired.
The audience guard is rechecked after asynchronous preparation before showing
the sheet. Five focused suites passed 39 checks, covering CSV/XLSX/PDF, failure
classification, cleanup, audience races and the existing browser path. Typecheck,
lint and translation validation passed with the compact Baam change included.
The new cancellation behavior still requires its own cloud build/native recheck.

The history-of-exports page also opened in the actual app. Its introductory guide
closed correctly and three previously generated synthetic price-list jobs showed
Ready. Touching one ready job's download icon left the app without a visible
file, system Share sheet or error. This matches a separate source-level missing
native handoff: those actions use direct attachment anchors. It does not prove
that no bytes reached the device. No new export job or provider operation was
created during this check; the native download path remains to be completed.

After that same download finished, the observed outcome changed: WKWebView
replaced the Bazaar interface with a tiny raw CSV table beneath the status bar,
without the app navigation or a Share control. The screenshot is preserved as
`export-history-inline-csv-before-fca36cf7.png`. Fully restarting the app recovered
the dashboard. The correction must keep the authenticated history page in place
and hand the downloaded file to the system sheet.

The date spacing matches a documented [WebKit issue with padded date inputs on
iOS](https://bugs.webkit.org/show_bug.cgi?id=301648). A bounded native-iOS style
removes that input appearance and applies explicit border-box containment while
retaining the real `date` type, picker, values, handlers and shared control height.
The existing offline fixture passed 30 checks, including populated/blank/disabled
date bounds and the column gap at widths 320, 393 and 1024, with unchanged web and
Android appearance/geometry. Its initial run failed a fixture assumption that
all controls must be at least 36px high: existing desktop controls intentionally
use 32px. The corrected assertion compares dates with an actual same-class text
control at the same width; no production height was changed to satisfy it.
That failed log remains preserved. Actual iOS field spacing and both native
calendars still need their new deployment check.

The history download correction uses an authenticated same-origin fetch of the
existing export endpoint, verifies the CSV/XLSX response and filename, and hands
the blob to native Share without navigating the WebView. Browser download links
retain their exact href. Native actions wait for platform hydration, show one
pending operation, handle Cancel quietly and expose localized errors with an
explicit retry. Account/role/store changes and unmount invalidate and abort the
operation; a stale request cannot clear the next account's pending state. The
existing server authorization and artifact-generation paths are unchanged.
Seven focused suites passed 92 checks, followed by typecheck, lint and translation
validation. Its combined production build and actual existing-file Share check
remain pending.

The actual customer page also rendered the empty state with export disabled.
In its add-customer sheet, focusing the lower address textarea with the hardware
keyboard disconnected kept the title/close and field above the software
keyboard. A synthetic `Q` and newline remained in that textarea, validation kept
creation disabled, and touching the close control returned to the unchanged
zero-customer list. No customer was created or updated.

Read-only public signup-mode requests returned `open` on `www.bazaar.kg` and
`invite_only` on this Preview. A missing open-signup link in this TestFlight
environment is therefore a server-policy difference. No production signup policy
or email-verification requirement was changed to make a test pass.

## Native Keychain and StoreKit fixture checkpoint

The earlier unsigned Debug test host had no usable entitlement identity; both
raw Keychain probes returned `-34018`. A normal local ad-hoc Simulator build was
then inspected: complete bound signatures/resources, no provisioning profile,
and the correct application identity in the actual Simulator Mach-O entitlements.
No shipping entitlement, account, or provisioning setting was changed.

With that exact compiled, blank/no-website host, the raw two-probe diagnostic
passed and all five actual Keychain integration cases passed without skips:
fresh-instance signing, device-only/non-synchronizing attributes, tampered
credentials, exact removal and isolation between attempts. The separate original
StoreKit class still failed its four purchase cases before obtaining a purchase;
the unknown-ID case passed. This is not a successful local StoreKit purchase.

The error occurs while configuring the test session and then at purchase, before
the application transaction finisher. It matches an Apple-reported Simulator
connection issue fixed in [iOS 26.6 release notes](https://developer.apple.com/documentation/ios-ipados-release-notes/ios-ipados-26_6-release-notes.md).
That match is a diagnosis to verify, not proof that a runtime update has fixed
this machine. A compatible available runtime and adequate disk space must be
established before the next bounded purchase experiment. Prior failed evidence
remains preserved. Apple Sandbox and physical-device purchases remain unverified.

## Remaining verification

On 13 November the combined `6a5d2503b0d7595bf38261e7325dd5945716f0f4`
Preview deployment was verified Ready and assigned to the dedicated iOS alias.
The actual Simulator app was fully restarted and the synthetic owner signed in.
In landscape with the real software keyboard, the compact Baam composer and
Back control now fit vertically. A stable screenshot exposed another issue:
the right-hand screen cutout covers part of Send. Portrait recovery preserved
the unsent synthetic draft, which was cleared without an AI request.

The follow-up adds physical left/right safe-area padding to the native iOS
workspace, with border-box sizing so the existing height contract remains intact.
Its immutable `ad0c9f658e3a34a281bd15de4f813149dbb51c13` production build was
verified Ready (`dpl_7FwUUzypvGPTYw7MEohfPJViHmDz`); the dedicated alias and actual
cutout/keyboard recheck remain pending. Typecheck, lint and translation checks
passed for that source.

On the actual app still serving `6a5d2503`, the two report date fields now have
separate bounded surfaces and a visible gap. The From/To native calendars each
opened November with their correct selected dates (7 and 13 November), then
cancelled without changing the period. Existing history download now opened
the real system Share sheet with a 554-byte CSV while retaining Bazaar behind
it. Cancelling restored the same history and enabled download controls without
a browser navigation or visible error. A second attempt reached Save to Files
on the device; no final saved-file verification is claimed.

That sheet exposed a readable-name issue: the cache collision UUID prefixes
the recipient-visible filename. The follow-up moves uniqueness into a private
attempt directory while preserving the safe basename and extension. Cleanup
removes only that exact file and its empty directory, nonrecursively. Three
focused sharing/export/download suites passed 74 checks, including concurrent
same-name attempts and terminal cleanup. Its combined quality/build checks and
actual system-sheet filename/save recheck remain pending. Combined typecheck,
lint and RU/KG/EN translation validation subsequently passed; the production
build and actual filename/save recheck remain open.

Continue the actual page pass after updating Preview: corrected Baam launch and
Back, scrolled menus and nested dialogs, reachable full-screen close controls,
auth return links, all relevant roles/stores, warehouse operations, reports,
files/share, profile/privacy, background/offline recovery and the remaining
routes. Preserve the established operational layouts.

Simulator checks complement the real iPhone and Apple Sandbox requirements.
They do not complete camera barcode, photo/file permissions, StoreKit purchases,
all paid catalog configuration, App Review, or publication. Those remain part of
the full release goal.
