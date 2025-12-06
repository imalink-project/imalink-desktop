#!/bin/bash
# Build complete imalink-desktop installer with bundled imalink-core
set -e

echo "=== Building Imalink Desktop Installer ==="
echo ""

# Check if imalink-core exists
if [ ! -d "../imalink-core" ]; then
    echo "Error: imalink-core not found at ../imalink-core"
    echo "Please clone imalink-core repository next to imalink-desktop"
    exit 1
fi

# Step 1: Build imalink-core executable
echo "Step 1: Building imalink-core executable..."
cd ../imalink-core

# Check if PyInstaller is installed
if ! command -v pyinstaller &> /dev/null; then
    echo "Installing PyInstaller..."
    pip install pyinstaller
fi

# Build imalink-core as standalone executable
pyinstaller --onefile \
    --name imalink-core \
    --add-data "src:src" \
    service/main.py

echo "✓ imalink-core executable built"
echo ""

# Step 2: Copy to desktop binaries folder
echo "Step 2: Copying imalink-core to desktop resources..."
cd ../imalink-desktop
mkdir -p src-tauri/binaries

if [ -f "../imalink-core/dist/imalink-core" ]; then
    cp ../imalink-core/dist/imalink-core src-tauri/binaries/
    chmod +x src-tauri/binaries/imalink-core
    echo "✓ Copied imalink-core to src-tauri/binaries/"
else
    echo "Error: imalink-core executable not found"
    exit 1
fi
echo ""

# Step 3: Build Tauri desktop app
echo "Step 3: Building Tauri desktop installer..."
npm run tauri build

echo ""
echo "=== Build Complete ==="
echo "Installer location:"
echo "  Linux: src-tauri/target/release/bundle/appimage/"
echo "  Windows: src-tauri/target/release/bundle/msi/"
echo "  macOS: src-tauri/target/release/bundle/dmg/"
