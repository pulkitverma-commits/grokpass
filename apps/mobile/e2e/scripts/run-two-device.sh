#!/usr/bin/env bash
# Two-device Maestro run (README.md "Two devices"): device A owns the room, device B joins.
# Requires: maestro on PATH, node, two booted simulators/emulators of the SAME platform, the dev
# build installed on both, relay port 4311 free.
#
#   MAESTRO_DEVICE_A=<udid|serial> MAESTRO_DEVICE_B=<udid|serial> apps/mobile/e2e/scripts/run-two-device.sh
#
# Optional: MAESTRO_BIOMETRIC=sim (unlock in 09), MAESTRO_UNIVERSAL_LINKS=1 (physical devices),
# MAESTRO_PUSH=1 (run 10, which needs a device that can mint a push token), KEEP_DEBUG=1 (keep
# Maestro's debug logs; screenshots and recordings are always deleted).
# The installed build must be the `e2e` EAS profile (EXPO_PUBLIC_E2E=1): 03 reads the full invite
# link from `invite.link`, which every other build masks (W1-9).
# Nothing in this script echoes a variable, and `set -x` is never enabled: the room link carries
# the invite token.
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
: "${MAESTRO_DEVICE_A:?set MAESTRO_DEVICE_A to the owner device udid/serial}"
: "${MAESTRO_DEVICE_B:?set MAESTRO_DEVICE_B to the joiner device udid/serial}"
relay="${MAESTRO_RELAY:-http://127.0.0.1:4311}"
debug="$(mktemp -d)"
shots="$(mktemp -d)"

cleanup() {
  # Maestro keeps a screenshot of the last screen on failure: never keep images from a run.
  find "$debug" -type f \( -name '*.png' -o -name '*.jpg' -o -name '*.mp4' \) -delete 2>/dev/null || true
  rm -rf "$shots" 2>/dev/null || true
  if [ "${KEEP_DEBUG:-0}" != "1" ]; then rm -rf "$debug"; fi
  if [ -n "${relay_pid:-}" ]; then kill "$relay_pid" 2>/dev/null || true; fi
  if [ "$(uname)" = "Darwin" ]; then defaults delete com.apple.iphonesimulator ScreenShotSaveLocation 2>/dev/null || true; fi
}
trap cleanup EXIT

# iOS Simulator "Save Screen" writes to the Desktop by default; point it at a temp dir we delete.
if [ "$(uname)" = "Darwin" ]; then defaults write com.apple.iphonesimulator ScreenShotSaveLocation "$shots"; fi

RELAY_SHOT_DIR="$shots" node "$here/relay/server.mjs" &
relay_pid=$!
for _ in $(seq 1 20); do curl -fsS "$relay/health" >/dev/null 2>&1 && break; sleep 0.25; done
curl -fsS -X DELETE "$relay/v" >/dev/null

run() { # run <device> <flow> [extra -e args]
  local device="$1" flow="$2"; shift 2
  maestro --device "$device" test "$here/flows/$flow" \
    --debug-output "$debug" \
    -e MAESTRO_RELAY="$relay" -e MAESTRO_DEVICE="$device" \
    -e MAESTRO_UNIVERSAL_LINKS="${MAESTRO_UNIVERSAL_LINKS:-0}" \
    -e MAESTRO_BIOMETRIC="${MAESTRO_BIOMETRIC:-skip}" "$@"
}

A="$MAESTRO_DEVICE_A"; B="$MAESTRO_DEVICE_B"
run "$A" 01-welcome-guest.yaml
run "$B" 01-welcome-guest.yaml
run "$A" 03-create-secret-room.yaml          # publishes the link to the relay
run "$B" 04-join-with-code.yaml              # reads it back; waits to be let in
run "$A" 04-let-in.yaml
run "$A" 05-message-roundtrip.yaml
run "$B" 05-message-roundtrip.peer.yaml
run "$A" 11-verify-safety-number.yaml       # publishes the safety number (not a secret)
run "$B" 11-verify-safety-number.peer.yaml  # compares it with its own
run "$A" 06-file-view-once.yaml
run "$B" 06-file-view-once.peer.yaml
run "$B" 07-screenshot-notice.peer.yaml      # system screenshot on B (B must be frontmost on iOS)
run "$A" 07-screenshot-notice.yaml
run "$A" 08-burn.yaml                        # also the clean-up: the throwaway room ends here
run "$B" 08-burn.peer.yaml
n=16
if [ "${MAESTRO_PUSH:-0}" = "1" ]; then run "$A" 10-settings-notifications.yaml; n=17; fi
run "$A" 09-panic-lock.yaml                  # last: it leaves A locked
printf 'two-device run: %s flows passed (A=%s B=%s)\n' "$n" "${A:0:8}…" "${B:0:8}…"
