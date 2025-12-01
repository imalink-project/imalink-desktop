# imalink-desktop (Proof of Concept)

> ⚠️ **PROOF OF CONCEPT** - This is an experimental desktop application for testing Tauri integration with imalink-core. Not intended for production use.

Desktop companion application for Imalink, providing local file system access and image processing capabilities.

## Purpose

This POC demonstrates:
- Local file selection using native OS dialogs
- Communication with imalink-core API for metadata extraction
- Display of PhotoCreateSchema data (EXIF, previews, GPS, camera settings)
- Tauri v2 + TypeScript architecture

## Status

**Experimental** - Basic functionality working:
- ✅ File selection via GTK dialog
- ✅ Send images to imalink-core (`/v1/process`)
- ✅ Receive and display PhotoCreateSchema JSON
- ✅ Show hotpreview (150x150 thumbnail)
- ✅ Show coldpreview (1200px max)
- ✅ Display full EXIF metadata

**Not implemented:**
- Batch processing multiple folders
- Local metadata caching
- Production build optimization/distribution

## Quick Start

```bash
# Install dependencies
npm install

# Run development server
npm run tauri dev

# Ensure imalink-core is running on http://localhost:8765
```

## Requirements

- **imalink-core** running locally (port 8765)
- Rust 1.70+ with cargo
- Node.js 20+
- Linux: WebKit2GTK 4.1 development libraries

## Architecture

```
User selects image file
    ↓
Desktop app (Tauri)
    ↓
imalink-core API (localhost:8765/v1/process)
    ↓
PhotoCreateSchema JSON response
    ↓
Display metadata + previews
```

## Technology Stack

- **Tauri v2** - Desktop framework (Rust + web frontend)
- **TypeScript** - Frontend language
- **Vite** - Frontend bundler
- **Vanilla JS** - No framework (lightweight POC)

## Related Repositories

- [imalink](https://github.com/kjelkols/imalink) - Backend API
- [imalink-web](https://github.com/kjelkols/imalink-web) - Web frontend
- [imalink-core](https://github.com/kjelkols/imalink-core) - Local metadata extraction API

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

