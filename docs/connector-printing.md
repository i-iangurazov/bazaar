# Connector Printing Protocol (Stub)

This document defines the planned local connector design for direct printer output.

## Scope
- Receipt printer target: Xprinter XP-P501A (58mm, ESC/POS).
- Label printer target: Xprinter XP-365B (label rolls, 203dpi, ZPL/TSPL depending firmware).
- Current status: server/API architecture is connector-ready, but direct device dispatch is intentionally stubbed.

## Local Service Model
- A lightweight local service runs on macOS/Windows near the printer.
- The service is paired to a Bazaar store via a short-lived pairing token/code.
- After pairing, the service receives print jobs for that store only.

## Security and Pairing
- Pairing token is exchanged once and stored as a hashed token server-side.
- Connector requests must include a connector token header.
- Jobs are scoped by organization + store.
- Inactive/unpaired connector devices are rejected.

## Job Delivery
- Connector periodically pulls queued jobs (polling endpoint).
- Job payload includes idempotency key and print payload.
- Connector sends status callbacks: `SENT` or `FAILED` with optional error details.

## Protocol Targets
- XP-P501A receipt jobs:
  - Render path target: ESC/POS command stream.
  - Typical command groups: init, text blocks, alignment, cut.
- XP-365B label jobs:
  - Render path target: ZPL or TSPL command stream (based on installed printer language).
  - Payload includes template, barcode data, item text, quantities.

## Queue and Status
- Queue semantics:
  - FIFO per store.
  - Retry with backoff on failures.
  - Idempotent processing per job id.
- Status callback updates:
  - `QUEUED -> PROCESSING -> SENT` on success.
  - `QUEUED/PROCESSING -> FAILED` with error and next-attempt timestamp.

## Current Stub Behavior
- Connector endpoints validate store settings and pairing state.
- If connector mode is selected but no paired device exists, API returns a localized clean error.
- If connector is paired, API currently returns a localized "not implemented yet" connector error.

## Next Implementation Step
- Add a small cross-platform connector daemon with:
  - secure token storage,
  - printer discovery and user selection,
  - ESC/POS and ZPL/TSPL render drivers,
  - job acknowledgement and heartbeat.
