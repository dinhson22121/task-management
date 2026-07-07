#!/usr/bin/env bash
# Downloads Piper TTS binaries (mac/win/linux x64) and the 3 available
# Vietnamese voice models into resources/piper/.
#
# resources/piper/ is gitignored (large binaries) — run this script once
# after cloning, or whenever resources/piper/ is missing/wiped.

set -euo pipefail

PIPER_VERSION="2023.11.14-2"
PHONEMIZE_VERSION="2023.11.14-4"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PIPER_DIR="$ROOT_DIR/resources/piper"

mkdir -p "$PIPER_DIR/voices" "$PIPER_DIR/mac" "$PIPER_DIR/win" "$PIPER_DIR/linux"

echo "== Vietnamese voice models =="
download_voice() {
  local repo_path="$1" name="$2"
  curl -sL --fail "https://huggingface.co/rhasspy/piper-voices/resolve/main/$repo_path/$name.onnx" -o "$PIPER_DIR/voices/$name.onnx"
  curl -sL --fail "https://huggingface.co/rhasspy/piper-voices/resolve/main/$repo_path/$name.onnx.json" -o "$PIPER_DIR/voices/$name.onnx.json"
}
download_voice "vi/vi_VN/vais1000/medium" "vi_VN-vais1000-medium"
download_voice "vi/vi_VN/25hours_single/low" "vi_VN-25hours_single-low"
download_voice "vi/vi_VN/vivos/x_low" "vi_VN-vivos-x_low"
download_voice "en/en_US/lessac/medium" "en_US-lessac-medium"

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT
mkdir -p "$WORK_DIR/mac" "$WORK_DIR/win" "$WORK_DIR/linux" "$WORK_DIR/phonemize"

echo "== Piper binaries ($PIPER_VERSION) =="
curl -sL --fail "https://github.com/rhasspy/piper/releases/download/$PIPER_VERSION/piper_macos_x64.tar.gz" -o "$WORK_DIR/mac.tar.gz"
curl -sL --fail "https://github.com/rhasspy/piper/releases/download/$PIPER_VERSION/piper_windows_amd64.zip" -o "$WORK_DIR/win.zip"
curl -sL --fail "https://github.com/rhasspy/piper/releases/download/$PIPER_VERSION/piper_linux_x86_64.tar.gz" -o "$WORK_DIR/linux.tar.gz"

tar -xzf "$WORK_DIR/mac.tar.gz" -C "$WORK_DIR/mac"
tar -xzf "$WORK_DIR/linux.tar.gz" -C "$WORK_DIR/linux"
unzip -q "$WORK_DIR/win.zip" -d "$WORK_DIR/win"

cp -R "$WORK_DIR/mac/piper/." "$PIPER_DIR/mac/"
cp -R "$WORK_DIR/linux/piper/." "$PIPER_DIR/linux/"
cp -R "$WORK_DIR/win/piper/." "$PIPER_DIR/win/"
rm -rf "$PIPER_DIR/mac/libonnxruntime.1.14.1.dylib.dSYM" "$PIPER_DIR/mac/pkgconfig" \
       "$PIPER_DIR/linux/pkgconfig" "$PIPER_DIR/win/pkgconfig"

chmod +x "$PIPER_DIR/mac/piper" "$PIPER_DIR/linux/piper" "$PIPER_DIR/win/piper.exe"

echo "== Fixing macOS binary (official release ships without shared libs / rpath) =="
curl -sL --fail "https://github.com/rhasspy/piper-phonemize/releases/download/$PHONEMIZE_VERSION/piper-phonemize_macos_x64.tar.gz" -o "$WORK_DIR/phonemize.tar.gz"
tar -xzf "$WORK_DIR/phonemize.tar.gz" -C "$WORK_DIR/phonemize"
cp "$WORK_DIR/phonemize/piper-phonemize/lib/libespeak-ng.1.dylib" \
   "$WORK_DIR/phonemize/piper-phonemize/lib/libpiper_phonemize.1.dylib" \
   "$WORK_DIR/phonemize/piper-phonemize/lib/libonnxruntime.1.14.1.dylib" \
   "$PIPER_DIR/mac/"
install_name_tool -add_rpath "@loader_path" "$PIPER_DIR/mac/piper" 2>/dev/null || true

echo "== Done =="
du -sh "$PIPER_DIR"/mac "$PIPER_DIR"/linux "$PIPER_DIR"/win "$PIPER_DIR"/voices
