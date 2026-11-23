#!/usr/bin/env bash
#
# Build the optional Linux HSD runtime used by the setup wizard.
#
# The runtime contains the official Node.js binary (so the app does not depend
# on a system Node install) plus a Linux build of hsd with its native modules.
# Build it on the oldest Linux baseline you intend to support.

set -euo pipefail

NODE_VERSION="${NODE_VERSION:-24.15.0}"
HSD_VERSION="${HSD_VERSION:-8.0.0}"
ARCH="${ARCH:-x64}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${OUT_DIR:-$ROOT/release}"
RUNTIME_NAME="Handess-HSD-Runtime-${HSD_VERSION}-linux-${ARCH}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

NODE_TARBALL="node-v${NODE_VERSION}-linux-${ARCH}.tar.xz"
NODE_DIR="$WORK/node-v${NODE_VERSION}-linux-${ARCH}"
STAGE="$WORK/$RUNTIME_NAME"
ZIP_PATH="$OUT_DIR/$RUNTIME_NAME.zip"

for tool in curl tar xz zip; do
  command -v "$tool" >/dev/null 2>&1 || {
    echo "Missing required tool: $tool" >&2
    exit 1
  }
done

echo "Downloading Node.js ${NODE_VERSION} (${ARCH})..."
curl -fsSLo "$WORK/$NODE_TARBALL" \
  "https://nodejs.org/dist/v${NODE_VERSION}/${NODE_TARBALL}"
curl -fsSLo "$WORK/SHASUMS256.txt" \
  "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt"

(
  cd "$WORK"
  grep " ${NODE_TARBALL}$" SHASUMS256.txt | sha256sum -c -
)

tar -xJf "$WORK/$NODE_TARBALL" -C "$WORK"

echo "Installing hsd ${HSD_VERSION} with the bundled Node.js..."
mkdir -p "$WORK/hsd-stage"
PATH="$NODE_DIR/bin:$PATH" npm install \
  --prefix "$WORK/hsd-stage" \
  --omit=dev \
  --no-audit \
  --no-fund \
  "hsd@${HSD_VERSION}"

if [ ! -f "$WORK/hsd-stage/node_modules/hsd/bin/hsd" ]; then
  echo "hsd install did not produce node_modules/hsd/bin/hsd" >&2
  exit 1
fi

echo "Staging runtime..."
mkdir -p "$STAGE"
cp "$NODE_DIR/bin/node" "$STAGE/node"
cp -R "$WORK/hsd-stage/node_modules/hsd" "$STAGE/hsd"
cp "$NODE_DIR/LICENSE" "$STAGE/LICENSE-Node.txt"
cp "$STAGE/hsd/LICENSE" "$STAGE/LICENSE-HSD.txt"
cp "$ROOT/THIRD_PARTY_NOTICES.md" "$STAGE/THIRD_PARTY_NOTICES.md"
chmod 0755 "$STAGE/node"

cat > "$STAGE/VERSION.json" <<EOF
{
  "name": "Handess HSD Runtime",
  "node": "${NODE_VERSION}",
  "hsd": "${HSD_VERSION}",
  "platform": "linux-${ARCH}",
  "builtAt": "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)",
  "purpose": "Private Node.js + hsd runtime downloaded by Handess Wallet setup"
}
EOF

cat > "$STAGE/README.txt" <<EOF
Handess HSD Runtime
===================

This optional runtime contains Node.js and hsd for Handess Wallet's setup wizard.
It is not part of the Handess Wallet installer package. It is downloaded only
when the user chooses "New to Handshake" or needs a private hsd runtime.

Run a quick check:
  ./node hsd/bin/hsd --version

Node.js and hsd remain under their own licenses. See LICENSE-Node.txt,
hsd/LICENSE, and THIRD_PARTY_NOTICES.md.
EOF

mkdir -p "$OUT_DIR"
rm -f "$ZIP_PATH"
(
  cd "$STAGE"
  zip -r -9 "$ZIP_PATH" . >/dev/null
)

HASH="$(sha256sum "$ZIP_PATH" | awk '{print $1}')"
SIZE="$(stat -c '%s' "$ZIP_PATH")"
printf '%s  %s\n' "$HASH" "$(basename "$ZIP_PATH")" > "$ZIP_PATH.sha256"

echo
echo "Runtime: $ZIP_PATH"
echo "Bytes:   $SIZE"
echo "SHA256:  $HASH"
