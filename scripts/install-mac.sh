#!/bin/bash
# Installs the HTML to Video panel for Adobe Premiere Pro on macOS.
set -e
SRC="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/HTMLtoVideo"

echo "Installing to: $DEST"
mkdir -p "$DEST"
rsync -a --delete --exclude ".git" --exclude "scripts" --exclude "tools" --exclude "skill" --exclude "app" --exclude "dist" --exclude "node_modules" --exclude ".github" --exclude "mobile" "$SRC/" "$DEST/"

# Allow unsigned extensions (needed for panels installed from source)
for v in 10 11 12 13 14; do
  defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1
done

echo "Done. Restart Premiere Pro or After Effects, then open Window > Extensions > HTML to Video."
