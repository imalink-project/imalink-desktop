# Copilot Instructions for imalink-desktop

> ⚠️ **PROOF OF CONCEPT** - This is an experimental desktop application. Code quality and architecture are intentionally simplified for rapid prototyping.

## Project Overview

Desktop companion application for Imalink, providing local file system access and image file management capabilities that the web frontend (`imalink-web`) cannot provide due to browser security restrictions.

**Status:** Proof of Concept - Basic functionality working, not production-ready.

## Project Status

This is a **proof-of-concept** to validate:
- Tauri v2 as desktop framework for Imalink
- Integration with imalink-core local API
- PhotoEgg workflow (file → core → metadata → display)
- Native file dialogs on Linux/WSL

**Working features:**
- File selection via native OS dialog
- Send image to imalink-core API
- Receive PhotoEgg JSON response
- Display metadata (EXIF, GPS, camera settings)
- Show hotpreview (150x150) and coldpreview (1200px)

**Not implemented:**
- Upload to imalink backend
- Batch processing
- Local storage
- Production build

## Planned Architecture

**Technology Stack:**
- **Tauri v2** - Desktop application framework (Rust backend + web frontend)
- **TypeScript** - Frontend language with Vite bundler
- **Vanilla TS** - No frontend framework (can be changed later)

**Directory Structure:**
- `src/` - TypeScript frontend
  - `main.ts` - Frontend entry point
  - `styles.css` - Global styles
  - `assets/` - Static assets
- `src-tauri/` - Rust backend
  - `src/lib.rs` - Tauri commands and app logic
  - `src/main.rs` - Entry point (minimal, calls lib.rs)
  - `Cargo.toml` - Rust dependencies
  - `tauri.conf.json` - Tauri configuration
  - `capabilities/` - Permission declarations
- `index.html` - HTML entry point
- `vite.config.ts` - Vite bundler configuration
- `tsconfig.json` - TypeScript configuration

**Core Responsibilities:**
- Local file system access for image files
- Send image files to `imalink-core` API (local) for metadata extraction
- Receive PhotoEgg objects (EXIF, preview, etc.) from imalink-core
- Upload PhotoEgg metadata to Imalink backend API
- Organize and manage local image file collections

**Architecture Flow:**
1. Desktop app scans/selects local image files
2. Sends files to `imalink-core` (local API server)
3. Receives `PhotoEgg` metadata response
4. Forwards PhotoEgg to Imalink backend API

**Relationship to Other Components:**
- `imalink` ([github.com/kjelkols/imalink](https://github.com/kjelkols/imalink)) - Backend API server
- `imalink-web` ([github.com/kjelkols/imalink-web](https://github.com/kjelkols/imalink-web)) - Main web frontend running on external server
- `imalink-core` ([github.com/kjelkols/imalink-core](https://github.com/kjelkols/imalink-core)) - Local API server for metadata extraction (EXIF, previews)
- `imalink-desktop` (this repo) - Desktop app that bridges local files with remote services

## Getting Started

**Development Commands:**
```bash
npm run dev         # Start development server (Vite + Tauri)
npm run build       # Build for production
npm run tauri [cmd] # Run Tauri CLI commands
```

**New to Rust and Tauri?**
- [Tauri Documentation](https://tauri.app/v1/guides/) - Official Tauri guides
- [Rust Book](https://doc.rust-lang.org/book/) - Learn Rust from scratch
- [Tauri Examples](https://github.com/tauri-apps/tauri/tree/dev/examples) - Sample Tauri applications

**Library Pattern:**
- Rust uses library crate pattern (`lib.rs`) not binary pattern
- Library name: `imalink_desktop_lib` (with underscores, note the `_lib` suffix)
- Package name: `imalink-desktop` (with dashes)
- This avoids Windows binary name conflicts

When the project structure is established, this file will be updated with:
- Tauri project structure and setup commands
- API communication patterns (imalink-core and backend)
- PhotoEgg data structure and handling
- File system scanning and organization workflows
- Development and build commands
- Project-specific conventions and patterns

## Temporary Notes

_This section will be replaced with actual project documentation once code is added._
