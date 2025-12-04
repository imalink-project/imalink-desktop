# local_storage_info JSON Schema

## Purpose
Fleksibel JSON-struktur for å lagre lokal filhåndteringsinformasjon i ImageFile. Alle felter er optional slik at struktur kan utvides uten breaking changes.

## Schema Design (v1.0)

```json
{
  "import_mode": "copy" | "register",
  "source_path": "/media/sdcard/DCIM/IMG_1234.jpg",
  "storage_path": "/home/user/photos/2025/12/IMG_1234.jpg",
  "imported_from": "sd_card" | "archive" | "local",
  "preserve_structure": true,
  "companion_files": ["IMG_1234.CR2"],
  "file_hash": "sha256:abc123...",
  "notes": "Imported from Sony Alpha camera"
}
```

## Field Definitions

### `import_mode` (string, optional)
How file was handled during import:
- `"copy"` - File was copied from source to permanent storage
- `"register"` - File registered in-place (no copy, user manages storage)

### `source_path` (string, optional)
Absolute path to original file location at import time.
- For Copy mode: Where file was copied FROM
- For Register mode: Where file is permanently stored

Examples:
```
"/media/sdcard/DCIM/100CANON/IMG_1234.jpg"
"/mnt/nas/photos/2024/vacation/sunset.raw"
"C:\\Users\\John\\Pictures\\IMG_1234.jpg"
```

### `storage_path` (string, optional)
Absolute path where file is permanently stored.
- For Copy mode: Destination path where file was copied TO
- For Register mode: Same as source_path (file wasn't moved)

Examples:
```
"/home/user/imalink_photos/2025/12/IMG_1234.jpg"
"/mnt/nas/photos/archive/2024/vacation/sunset.raw"
```

### `imported_from` (string, optional)
Source type for UI/organization hints:
- `"sd_card"` - Removable SD card
- `"archive"` - Existing organized photo archive
- `"local"` - Local hard drive
- `"nas"` - Network attached storage
- `"external"` - External USB drive

### `preserve_structure` (boolean, optional)
Whether original directory structure was preserved during copy.
- `true` - Kept original folder hierarchy
- `false` - Files flattened or reorganized

### `companion_files` (array of strings, optional)
List of companion file basenames detected and imported together.

Example: `["IMG_1234.CR2", "IMG_1234.JPG"]`

### `file_hash` (string, optional)
SHA256 checksum for file integrity verification.

Format: `"sha256:<64-hex-chars>"`

### `notes` (string, optional)
User-provided or auto-generated import notes.

Examples:
- `"Imported from Sony Alpha camera - vacation trip"`
- `"Bulk import from old archive - needs organization"`

## Example Usage Scenarios

### Scenario 1: Copy from SD Card
```json
{
  "import_mode": "copy",
  "source_path": "/media/sdcard/DCIM/IMG_1234.jpg",
  "storage_path": "/home/user/photos/2025/12/IMG_1234.jpg",
  "imported_from": "sd_card",
  "preserve_structure": false,
  "companion_files": ["IMG_1234.CR2"],
  "notes": "Imported from SD card - Christmas photos"
}
```

### Scenario 2: Register from Archive
```json
{
  "import_mode": "register",
  "source_path": "/mnt/nas/photos/2024/vacation/sunset.raw",
  "storage_path": "/mnt/nas/photos/2024/vacation/sunset.raw",
  "imported_from": "nas",
  "preserve_structure": true,
  "notes": "Registered from existing NAS archive"
}
```

### Scenario 3: Companion Files (RAW + JPEG)
First file (creates Photo):
```json
{
  "import_mode": "copy",
  "source_path": "/media/sdcard/IMG_1234.JPG",
  "storage_path": "/home/user/photos/2025/12/IMG_1234.JPG",
  "imported_from": "sd_card",
  "companion_files": ["IMG_1234.JPG", "IMG_1234.CR2"]
}
```

Second file (adds to Photo):
```json
{
  "import_mode": "copy",
  "source_path": "/media/sdcard/IMG_1234.CR2",
  "storage_path": "/home/user/photos/2025/12/IMG_1234.CR2",
  "imported_from": "sd_card",
  "companion_files": ["IMG_1234.JPG", "IMG_1234.CR2"]
}
```

## Refactoring Safety

**Why this design is refactoring-safe:**

1. **All fields optional** - Can add new fields without breaking existing data
2. **JSON flexibility** - Backend treats as opaque JSON blob
3. **No schema validation** - Frontend decides what to store
4. **Additive changes only** - Never remove or rename fields
5. **Forward compatible** - Old code ignores unknown fields

**Migration path:**
- Phase 1: Basic fields (import_mode, source_path, storage_path)
- Phase 2: Add preserve_structure, file_hash
- Phase 3: Add auto_organize settings, duplicate_detection
- All phases compatible - no data migration needed

## Storage Location Tracking

The `local_storage_info` is used by desktop app to:
1. Track where original files are located
2. Know if files were copied or registered in-place
3. Re-find files if needed (export, regenerate previews)
4. Display import source info in UI
5. Verify file integrity via checksums

Backend treats this as opaque JSON - desktop app has full control over structure.
