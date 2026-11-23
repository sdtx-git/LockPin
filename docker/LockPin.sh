#!/bin/sh
set -e
DIR=$(cd "$(dirname "$0")" && pwd)
APP="$DIR/LockPin.AppImage"
export LOCKPIN_DATA_DIR="$DIR"
export APPIMAGE_EXTRACT_AND_RUN=1
if [ -x "$APP" ]; then
  exec "$APP" "$@"
fi
RUN_DIR="${XDG_RUNTIME_DIR:-/tmp}/lockpin-$(id -u)"
mkdir -p "$RUN_DIR"
chmod 700 "$RUN_DIR"
cp "$APP" "$RUN_DIR/LockPin.AppImage"
chmod 700 "$RUN_DIR/LockPin.AppImage"
exec "$RUN_DIR/LockPin.AppImage" "$@"
