#!/bin/sh
set -eu

# release.ts sets NODE_BINARY to its running Node 22. Direct Xcode users can
# supply NODE_BINARY explicitly; never hard-code a developer's home directory.
if [ -z "${NODE_BINARY:-}" ]; then
  NODE_BINARY="$(command -v node || true)"
fi
if [ -z "$NODE_BINARY" ] || [ ! -x "$NODE_BINARY" ]; then
  echo "error: Node 22 is required. Build with mobile:release or provide NODE_BINARY."
  exit 1
fi
cd "$SRCROOT/../.."
exec "$NODE_BINARY" --import tsx scripts/mobile/ios-build-config.ts
