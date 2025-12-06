# Building Imalink Desktop Installer

This guide explains how to build a complete installer that bundles both imalink-desktop and imalink-core.

## Prerequisites

1. **imalink-core repository** must be cloned next to imalink-desktop:
   ```
   /home/user/
   ├── imalink-desktop/
   └── imalink-core/
   ```

2. **PyInstaller** for building imalink-core executable:
   ```bash
   pip install pyinstaller
   ```

3. **Tauri CLI** for building desktop app:
   ```bash
   npm install
   ```

## Building the Installer

Simply run the build script:

```bash
./build-installer.sh
```

This will:
1. Build imalink-core as a standalone executable using PyInstaller
2. Copy the executable to `src-tauri/binaries/`
3. Build the Tauri desktop app with bundled core
4. Generate installer in `src-tauri/target/release/bundle/`

## What Happens at Runtime

When a user runs the installed application:

1. Desktop app starts
2. Automatically launches bundled imalink-core on port 8765
3. Desktop connects to core for image processing
4. When desktop closes, core is automatically stopped

The user sees only one application - no manual setup required!

## Installer Locations

After build completes:

- **Linux**: `src-tauri/target/release/bundle/appimage/`
- **Windows**: `src-tauri/target/release/bundle/msi/`
- **macOS**: `src-tauri/target/release/bundle/dmg/`

## Development Mode

For development, run core manually in a separate terminal:

```bash
cd ../imalink-core
python service/main.py
```

Then start desktop in dev mode:

```bash
npm run dev
```

This allows you to see core output and restart it independently during development.
