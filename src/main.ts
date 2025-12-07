import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Store } from "@tauri-apps/plugin-store";

// ===== Authentication Interfaces =====

interface User {
  id: number;
  username: string;
  email: string;
  display_name: string | null;  // Can be null from backend
  is_active: boolean;
  default_author_id?: number | null;  // NEW in v2.3 - points to user's self-author
}

interface LoginResponse {
  access_token: string;
  token_type: string;
  user: User;
}

// ===== Global State =====

let authToken: string | null = null;
let currentUser: User | null = null;
let credentialsStore: Store | null = null;

// PhotoCreateSchema structure - matches imalink-core v2.x API response
// This is the canonical format from imalink-core API v2.x+
interface PhotoCreateSchema {
  // Identity (required)
  hothash: string;
  
  // Hotpreview (always present)
  hotpreview_base64: string;
  hotpreview_width: number;
  hotpreview_height: number;
  
  // Coldpreview (optional)
  coldpreview_base64?: string | null;
  coldpreview_width?: number | null;
  coldpreview_height?: number | null;
  
  // File info (required)
  width: number;
  height: number;
  
  // Timestamps (optional)
  taken_at?: string | null;
  
  // GPS (optional)
  gps_latitude?: number | null;
  gps_longitude?: number | null;
  
  // NEW in v2.x: Complete EXIF metadata in flexible JSON object
  exif_dict?: Record<string, any>;
  
  // NEW in v2.x: List of source image files
  image_file_list?: ImageFileSchema[];
  
  // Organization fields (set by desktop before upload)
  input_channel_id?: number | null;
  rating?: number;
  visibility?: string;
  category?: string | null;
  author_id?: number | null;
  stack_id?: number | null;
}

interface ImageFileSchema {
  filename: string;
  file_size?: number;
  format?: string | null;
  is_raw?: boolean;
  local_storage_info?: any;
  imported_info?: any;
}

// Companion file grouping
interface CompanionGroup {
  basename: string;
  masterFile: string;
  companionFiles: string[];
  allFiles: string[];
  masterPriority: number;
}

// InputChannel structure - matches imalink backend API v2.4
// InputChannel structure - matches actual backend response
interface InputChannel {
  id: number;
  imported_at: string;
  title?: string | null;  // Can be null from backend
  description?: string | null;
  default_author_id?: number | null;
  images_count: number;
}

// PhotoCreateSchema upload response - API v2.4
interface PhotoCreateResponse {
  id: number;
  hothash: string;
  user_id: number;
  width: number;
  height: number;
  taken_at?: string | null;
  gps_latitude?: number | null;
  gps_longitude?: number | null;
  rating: number;
  category?: string | null;
  visibility: string;
  created_at: string;
  updated_at?: string | null;  // Optional - backend may not return it
  is_duplicate?: boolean;  // NEW in API v2.4 - indicates if photo already existed
}

let selectedFiles: string[] = [];
let selectedDirPath: string | null = null;
let selectedInputChannelId: number | null = null;

async function scanDirectory(dirPath: string) {
  const statusEl = document.querySelector("#status");
  const fileListEl = document.querySelector("#file-list") as HTMLElement;
  const filesEl = document.querySelector("#files");
  const startImportBtn = document.querySelector("#start-import") as HTMLButtonElement;
  
  try {
    if (statusEl) {
      statusEl.textContent = "Skanner katalog...";
      statusEl.className = "loading";
    }
    
    // Scan directory for image files
    selectedFiles = await invoke("scan_directory", {
      dirPath: dirPath
    });
    
    // Group files to detect companions
    const companionGroups = groupCompanionFiles(selectedFiles);
    const totalFiles = companionGroups.reduce((sum, g) => sum + g.allFiles.length, 0);
    
    if (filesEl) {
      filesEl.innerHTML = `<p>Funnet ${totalFiles} bildefiler i ${companionGroups.length} grupper</p>`;
      
      if (companionGroups.length > 0) {
        const groupList = companionGroups.slice(0, 10).map(g => {
          const basename = g.basename;
          const fileCount = g.allFiles.length;
          const fileNames = g.allFiles.map(f => f.split('/').pop()).join(', ');
          return `<li><strong>${basename}</strong> (${fileCount} fil${fileCount > 1 ? 'er' : ''}): ${fileNames}</li>`;
        }).join('');
        filesEl.innerHTML += `<ul>${groupList}${companionGroups.length > 10 ? `<li>... og ${companionGroups.length - 10} flere grupper</li>` : ''}</ul>`;
      }
    }
    
    if (fileListEl) {
      fileListEl.style.display = selectedFiles.length > 0 ? "block" : "none";
    }
    
    if (startImportBtn) {
      startImportBtn.disabled = selectedFiles.length === 0;
    }
    
    if (statusEl) {
      statusEl.textContent = selectedFiles.length > 0 ? `✓ Funnet ${totalFiles} filer i ${companionGroups.length} grupper` : "Ingen bildefiler funnet";
      statusEl.className = selectedFiles.length > 0 ? "success" : "error";
    }
  } catch (error) {
    if (statusEl) {
      statusEl.textContent = `Feil ved skanning: ${error}`;
      statusEl.className = "error";
    }
    console.error("Failed to scan directory:", error);
  }
}

// ===== Companion File Detection =====

function groupCompanionFiles(filePaths: string[]): CompanionGroup[] {
  // File extension priorities (lower = preferred master)
  const priorities: Record<string, number> = {
    'jpg': 1,
    'jpeg': 1,
    'heic': 2,
    'png': 3,
    'cr2': 10,
    'nef': 10,
    'arw': 10,
    'dng': 10,
    'orf': 10,
    'rw2': 10,
    'raw': 10
  };

  // Group files by directory + basename
  const groups = new Map<string, { files: string[], exts: string[], priorities: number[] }>();

  for (const filePath of filePaths) {
    const parts = filePath.split('/');
    const fileName = parts[parts.length - 1];
    const directory = parts.slice(0, -1).join('/');
    const lastDot = fileName.lastIndexOf('.');
    
    if (lastDot === -1) continue; // Skip files without extension
    
    const basename = fileName.substring(0, lastDot);
    const ext = fileName.substring(lastDot + 1).toLowerCase();
    const priority = priorities[ext] || 99;
    
    // Group key = directory + basename (same-directory matching only)
    const groupKey = `${directory}/${basename}`;
    
    if (!groups.has(groupKey)) {
      groups.set(groupKey, { files: [], exts: [], priorities: [] });
    }
    
    const group = groups.get(groupKey)!;
    group.files.push(filePath);
    group.exts.push(ext);
    group.priorities.push(priority);
  }

  // Convert to CompanionGroup array
  const companionGroups: CompanionGroup[] = [];

  for (const [groupKey, group] of groups) {
    const basename = groupKey.split('/').pop() || groupKey;
    
    // Find master file (lowest priority number)
    let masterIndex = 0;
    let lowestPriority = group.priorities[0];
    
    for (let i = 1; i < group.priorities.length; i++) {
      if (group.priorities[i] < lowestPriority) {
        lowestPriority = group.priorities[i];
        masterIndex = i;
      }
    }
    
    const masterFile = group.files[masterIndex];
    const companionFiles = group.files.filter((_, i) => i !== masterIndex);
    
    companionGroups.push({
      basename,
      masterFile,
      companionFiles,
      allFiles: group.files,
      masterPriority: lowestPriority
    });
  }

  return companionGroups;
}

async function startImport() {
  if (selectedFiles.length === 0) {
    return;
  }

  const statusEl = document.querySelector("#status");
  const progressEl = document.querySelector("#progress") as HTMLElement;
  const progressFillEl = document.querySelector("#progress-fill") as HTMLElement;
  const progressTextEl = document.querySelector("#progress-text");
  const resultsEl = document.querySelector("#results") as HTMLElement;
  const resultsContentEl = document.querySelector("#results-content");
  const startImportBtn = document.querySelector("#start-import") as HTMLButtonElement;

  // Get configuration
  const coreUrlInput = document.querySelector("#core-url") as HTMLInputElement;
  const backendUrlInput = document.querySelector("#backend-url") as HTMLInputElement;

  const coreApiUrl = coreUrlInput?.value || "http://localhost:8765";
  const backendUrl = backendUrlInput?.value || "https://api.trollfjell.com";

  if (!authToken) {
    if (statusEl) {
      statusEl.textContent = "Feil: Du må være innlogget";
      statusEl.className = "error";
    }
    return;
  }

  if (!selectedInputChannelId) {
    if (statusEl) {
      statusEl.textContent = "Feil: Du må velge eller opprette en input channel";
      statusEl.className = "error";
    }
    return;
  }

  startImportBtn.disabled = true;

  try {
    // Get import mode settings
    const copyModeRadio = document.querySelector('input[name="import-mode"][value="copy"]') as HTMLInputElement;
    const isCopyMode = copyModeRadio?.checked || false;
    const destinationPath = (document.querySelector("#destination-path") as HTMLInputElement)?.value;
    
    // Validate Copy mode settings
    if (isCopyMode && !destinationPath) {
      if (statusEl) {
        statusEl.textContent = "Feil: Du må velge destinasjonskatalog for Copy-modus";
        statusEl.className = "error";
      }
      startImportBtn.disabled = false;
      return;
    }
    
    console.log("Starting import process...");
    console.log("Import mode:", isCopyMode ? "Copy" : "Register");
    console.log("Selected files count:", selectedFiles.length);
    
    if (statusEl) {
      statusEl.textContent = `Bruker input channel ID: ${selectedInputChannelId} (${isCopyMode ? 'Copy' : 'Register'} mode)`;
      statusEl.className = "success";
    }

    const inputChannelId = selectedInputChannelId;

    // Step 2: Group files by companions
    console.log("Grouping companion files...");
    const companionGroups = groupCompanionFiles(selectedFiles);
    console.log(`Found ${companionGroups.length} groups from ${selectedFiles.length} files`);

    // Step 3: Process each group
    if (progressEl) {
      progressEl.style.display = "block";
    }
    if (resultsEl) {
      resultsEl.style.display = "block";
    }

    const results: { file: string; success: boolean; error?: string; hothash?: string; isDuplicate?: boolean; isSkipped?: boolean; skipReason?: string; companionCount?: number; allFiles?: string[] }[] = [];

    for (let i = 0; i < companionGroups.length; i++) {
      const group = companionGroups[i];
      const masterFilePath = group.masterFile;
      const masterFileName = masterFilePath.split('/').pop() || masterFilePath;
      const companionCount = group.companionFiles.length;
      
      // Update progress
      const progress = ((i + 1) / companionGroups.length) * 100;
      if (progressFillEl) {
        progressFillEl.style.width = `${progress}%`;
      }
      if (progressTextEl) {
        const groupInfo = companionCount > 0 ? ` + ${companionCount} companion(s)` : '';
        progressTextEl.textContent = `Behandler gruppe ${i + 1} av ${companionGroups.length}: ${masterFileName}${groupInfo}`;
      }

      try {
        console.log(`Processing group: ${group.basename} (master: ${masterFileName}, companions: ${companionCount})`);
        
        // Step 3a: Process master file through imalink-core
        console.log(`Calling process_image_file for master: ${masterFileName}`);
        let photoCreateSchema: PhotoCreateSchema;
        
        try {
          photoCreateSchema = await invoke("process_image_file", {
            filePath: masterFilePath,
            coreApiUrl
          });
          console.log(`Got PhotoCreateSchema for ${masterFileName}:`, photoCreateSchema.hothash);
        } catch (coreError) {
          // Failed to process master file (likely RAW without rawpy support)
          console.warn(`Cannot process master file ${masterFileName}:`, coreError);
          results.push({
            file: masterFileName,
            success: false,
            isSkipped: true,
            skipReason: `Cannot process file: ${String(coreError)}`,
            companionCount,
            allFiles: group.allFiles.map(f => f.split('/').pop() || f)
          });
          continue; // Skip this group
        }

        // Step 3b: Handle file storage for master (copy or register)
        let finalPath = masterFilePath;
        const allFilenames = group.allFiles.map(f => f.split('/').pop() || f);
        
        let localStorageInfo: any = {
          import_mode: isCopyMode ? "copy" : "register",
          source_path: masterFilePath,
          imported_from: selectedDirPath?.includes("/media/") || selectedDirPath?.includes("/mnt/") ? "sd_card" : "archive",
          companion_files: allFilenames  // Include all files in group
        };

        if (isCopyMode && destinationPath) {
          console.log(`Copying master file to ${destinationPath}`);
          try {
            finalPath = await invoke("copy_file_to_storage", {
              sourcePath: masterFilePath,
              destinationDir: destinationPath,
              preserveStructure: false,  // Flat copy for now
              sourceBaseDir: null
            });
            console.log(`Master file copied to: ${finalPath}`);
            localStorageInfo.storage_path = finalPath;
          } catch (copyError) {
            console.error(`Failed to copy file: ${copyError}`);
            throw new Error(`Kunne ikke kopiere fil: ${copyError}`);
          }
        } else {
          // Register mode - file stays where it is
          localStorageInfo.storage_path = masterFilePath;
        }

        // Step 3c: Get master file metadata
        console.log(`Getting metadata for master: ${masterFileName}`);
        
        // Step 3d: Update PhotoCreateSchema's image_file_list with master metadata
        if (!photoCreateSchema.image_file_list) {
          photoCreateSchema.image_file_list = [];
        }
        
        // Update master file's local_storage_info in image_file_list
        if (photoCreateSchema.image_file_list.length > 0) {
          photoCreateSchema.image_file_list[0].local_storage_info = localStorageInfo;
          photoCreateSchema.image_file_list[0].imported_info = {
            imported_at: new Date().toISOString(),
            original_selection: selectedDirPath
          };
        }
        
        // Step 3e: Add companion files to image_file_list
        for (const companionPath of group.companionFiles) {
          const companionFileName = companionPath.split('/').pop() || companionPath;
          console.log(`Adding companion file: ${companionFileName}`);
          
          // Handle file storage for companion
          let companionFinalPath = companionPath;
          let companionLocalStorageInfo: any = {
            import_mode: isCopyMode ? "copy" : "register",
            source_path: companionPath,
            imported_from: selectedDirPath?.includes("/media/") || selectedDirPath?.includes("/mnt/") ? "sd_card" : "archive",
            companion_files: allFilenames
          };
          
          if (isCopyMode && destinationPath) {
            console.log(`Copying companion file to ${destinationPath}`);
            try {
              companionFinalPath = await invoke("copy_file_to_storage", {
                sourcePath: companionPath,
                destinationDir: destinationPath,
                preserveStructure: false,
                sourceBaseDir: null
              });
              companionLocalStorageInfo.storage_path = companionFinalPath;
            } catch (copyError) {
              console.error(`Failed to copy companion file: ${copyError}`);
              // Continue anyway - companion copy is not critical
              companionLocalStorageInfo.storage_path = companionPath;
            }
          } else {
            companionLocalStorageInfo.storage_path = companionPath;
          }
          
          // Get companion file metadata
          const companionFileSize = await invoke("get_file_size", { filePath: companionFinalPath }) as number;
          const companionFileExt = companionFileName.split('.').pop()?.toLowerCase() || "unknown";
          const companionFileFormat = ["jpg", "jpeg"].includes(companionFileExt) ? "jpeg" : 
                                     ["cr2", "nef", "arw", "dng", "orf", "rw2"].includes(companionFileExt) ? "raw" : companionFileExt;
          
          // Add companion to image_file_list (NO hotpreview/hothash/exif_dict)
          photoCreateSchema.image_file_list.push({
            filename: companionFileName,
            file_size: companionFileSize,
            format: companionFileFormat,
            is_raw: companionFileFormat === "raw",
            local_storage_info: companionLocalStorageInfo,
            imported_info: {
              imported_at: new Date().toISOString(),
              original_selection: selectedDirPath
            }
          });
        }
        
        // Step 3f: Add input_channel_id to PhotoCreateSchema
        photoCreateSchema.input_channel_id = inputChannelId;
        
        // Upload complete PhotoCreateSchema to backend
        console.log(`Uploading ${masterFileName} to channel ${inputChannelId}`);
        
        const uploadResult: PhotoCreateResponse = await invoke("upload_photo_create_schema", {
          backendUrl,
          photoCreateSchema,
          inputChannelId,
          authToken
        });
        
        if (uploadResult.is_duplicate) {
          console.log(`Duplicate skipped for ${masterFileName}:`, uploadResult.hothash);
        } else {
          console.log(`Upload successful for ${masterFileName}:`, uploadResult.hothash);
        }

        results.push({
          file: masterFileName,
          success: true,
          hothash: uploadResult.hothash,
          isDuplicate: uploadResult.is_duplicate,
          companionCount,
          allFiles: group.allFiles.map(f => f.split('/').pop() || f)
        });
      } catch (error) {
        console.error(`Error processing ${masterFileName}:`, error);
        results.push({
          file: masterFileName,
          success: false,
          error: String(error),
          companionCount,
          allFiles: group.allFiles.map(f => f.split('/').pop() || f)
        });
      }
    }

    // Step 4: Show results
    const successCount = results.filter(r => r.success && !r.isDuplicate && !r.isSkipped).length;
    const duplicateCount = results.filter(r => r.success && r.isDuplicate).length;
    const skippedCount = results.filter(r => r.isSkipped).length;
    const failCount = results.filter(r => !r.success && !r.isSkipped).length;
    const totalCompanions = results.reduce((sum, r) => sum + (r.companionCount || 0), 0);

    if (statusEl) {
      const parts = [];
      if (successCount > 0) parts.push(`${successCount} nye`);
      if (duplicateCount > 0) parts.push(`${duplicateCount} duplikater`);
      if (skippedCount > 0) parts.push(`${skippedCount} hoppet over`);
      if (failCount > 0) parts.push(`${failCount} feil`);
      
      statusEl.textContent = `Import fullført: ${parts.join(', ')}`;
      statusEl.className = (failCount === 0 && skippedCount === 0) ? "success" : "warning";
    }

    if (resultsContentEl) {
      let html = `<h3>Sammendrag</h3>`;
      html += `<p><strong>Totalt behandlet:</strong> ${companionGroups.length} grupper (${selectedFiles.length} filer)</p>`;
      html += `<p><strong>Nye bilder:</strong> ${successCount}</p>`;
      if (totalCompanions > 0) {
        html += `<p><strong>Companion-filer:</strong> ${totalCompanions}</p>`;
      }
      if (duplicateCount > 0) {
        html += `<p><strong>Duplikater (hoppet over):</strong> ${duplicateCount}</p>`;
      }
      if (skippedCount > 0) {
        html += `<p><strong>Hoppet over (kan ikke prosessere):</strong> ${skippedCount}</p>`;
      }
      html += `<p><strong>Feil:</strong> ${failCount}</p>`;
      html += `<p><strong>Input Channel ID:</strong> ${inputChannelId}</p>`;
      
      if (skippedCount > 0) {
        html += `<h3>⚠ Hoppet over:</h3><ul>`;
        results.filter(r => r.isSkipped).forEach(r => {
          const companionInfo = (r.companionCount || 0) > 0 ? ` (+${r.companionCount} companion(s))` : '';
          html += `<li><strong>${r.file}${companionInfo}:</strong> ${r.skipReason}</li>`;
        });
        html += `</ul>`;
      }
      
      if (failCount > 0) {
        html += `<h3>❌ Feil:</h3><ul>`;
        results.filter(r => !r.success && !r.isSkipped).forEach(r => {
          const companionInfo = (r.companionCount || 0) > 0 ? ` (+${r.companionCount} companion(s))` : '';
          html += `<li><strong>${r.file}${companionInfo}:</strong> ${r.error}</li>`;
        });
        html += `</ul>`;
      }

      html += `<details><summary>Alle grupper (klikk for å utvide)</summary><ul>`;
      results.forEach(r => {
        let icon = '✗';
        let status = '';
        if (r.success) {
          if (r.isDuplicate) {
            icon = '⊙';
            status = ' <em>(duplikat)</em>';
          } else {
            icon = '✓';
          }
        } else if (r.isSkipped) {
          icon = '⚠';
          status = ' <em>(hoppet over)</em>';
        }
        const companionInfo = (r.companionCount || 0) > 0 ? ` +${r.companionCount}` : '';
        const fileList = r.allFiles && r.allFiles.length > 0 ? `<br>&nbsp;&nbsp;&nbsp;&nbsp;📁 Filer: ${r.allFiles.join(', ')}` : '';
        html += `<li>${icon} ${r.file}${companionInfo}${status}${r.hothash ? ` (${r.hothash.substring(0, 8)}...)` : ''}${fileList}</li>`;
      });
      html += `</ul></details>`;

      resultsContentEl.innerHTML = html;
    }

  } catch (error) {
    console.error("Import failed with error:", error);
    console.error("Error type:", typeof error);
    console.error("Error stringified:", JSON.stringify(error));
    
    if (statusEl) {
      statusEl.textContent = `Feil: ${error}`;
      statusEl.className = "error";
    }
  } finally {
    startImportBtn.disabled = false;
  }
}

// ===== Authentication Functions =====

async function checkCoreHealth() {
  const coreUrlInput = document.querySelector("#core-url") as HTMLInputElement;
  const coreStatus = document.querySelector("#core-status");
  const coreApiUrl = coreUrlInput?.value || "http://localhost:8765";
  
  if (coreStatus) {
    coreStatus.textContent = "Tester tilkobling til imalink-core...";
    coreStatus.className = "info-text loading";
  }
  
  try {
    const result: string = await invoke("check_core_health", { coreApiUrl });
    if (coreStatus) {
      coreStatus.textContent = result;
      coreStatus.className = "info-text success";
    }
    console.log("Core health check passed:", result);
  } catch (error) {
    if (coreStatus) {
      coreStatus.textContent = `❌ ${error}`;
      coreStatus.className = "info-text error";
    }
    console.error("Core health check failed:", error);
  }
}

async function initializeAuth() {
  try {
    // Initialize store
    credentialsStore = await Store.load("credentials.json");
    
    // Try to load saved token
    const savedToken = await credentialsStore.get<string>("auth_token");
    const backendUrl = (document.querySelector("#backend-url") as HTMLInputElement)?.value || "http://localhost:8000";
    
    if (savedToken) {
      // Validate token
      try {
        currentUser = await invoke("validate_token", {
          backendUrl,
          authToken: savedToken
        });
        authToken = savedToken;
        showMainScreen();
        
        // Check core health after showing main screen
        setTimeout(checkCoreHealth, 1000);
      } catch {
        // Token invalid, show login
        showLoginScreen();
      }
    } else {
      showLoginScreen();
    }
  } catch (error) {
    console.error("Failed to initialize auth:", error);
    showLoginScreen();
  }
}

async function handleLogin() {
  const usernameInput = document.querySelector("#login-username") as HTMLInputElement;
  const passwordInput = document.querySelector("#login-password") as HTMLInputElement;
  const backendUrlInput = document.querySelector("#backend-url") as HTMLInputElement;
  const loginStatus = document.querySelector("#login-status");
  const loginBtn = document.querySelector("#login-btn") as HTMLButtonElement;
  
  const username = usernameInput?.value;
  const password = passwordInput?.value;
  const backendUrl = backendUrlInput?.value || "https://api.trollfjell.com";
  
  if (!username || !password) {
    if (loginStatus) {
      loginStatus.textContent = "Brukernavn og passord er påkrevd";
      loginStatus.className = "error";
    }
    return;
  }
  
  if (loginBtn) loginBtn.disabled = true;
  if (loginStatus) {
    loginStatus.textContent = "Logger inn...";
    loginStatus.className = "loading";
  }
  
  try {
    const response: LoginResponse = await invoke("login", {
      backendUrl,
      username,
      password
    });
    
    authToken = response.access_token;
    currentUser = response.user;
    
    // Save token securely
    if (credentialsStore) {
      await credentialsStore.set("auth_token", authToken);
      await credentialsStore.save();
    }
    
    showMainScreen();
  } catch (error) {
    if (loginStatus) {
      loginStatus.textContent = `Innlogging feilet: ${error}`;
      loginStatus.className = "error";
    }
    console.error("Login failed:", error);
  } finally {
    if (loginBtn) loginBtn.disabled = false;
  }
}

async function handleRegister() {
  const usernameInput = document.querySelector("#register-username") as HTMLInputElement;
  const emailInput = document.querySelector("#register-email") as HTMLInputElement;
  const passwordInput = document.querySelector("#register-password") as HTMLInputElement;
  const displayNameInput = document.querySelector("#register-displayname") as HTMLInputElement;
  const backendUrlInput = document.querySelector("#backend-url") as HTMLInputElement;
  const registerStatus = document.querySelector("#register-status");
  const registerBtn = document.querySelector("#register-btn") as HTMLButtonElement;
  
  const username = usernameInput?.value;
  const email = emailInput?.value;
  const password = passwordInput?.value;
  const displayName = displayNameInput?.value;
  const backendUrl = backendUrlInput?.value || "https://api.trollfjell.com";
  
  if (!username || !email || !password || !displayName) {
    if (registerStatus) {
      registerStatus.textContent = "Alle felter er påkrevd";
      registerStatus.className = "error";
    }
    return;
  }
  
  if (registerBtn) registerBtn.disabled = true;
  if (registerStatus) {
    registerStatus.textContent = "Oppretter bruker...";
    registerStatus.className = "loading";
  }
  
  try {
    const user: User = await invoke("register", {
      backendUrl,
      username,
      email,
      password,
      displayName
    });
    
    if (registerStatus) {
      registerStatus.textContent = `✓ Bruker opprettet! Logger inn...`;
      registerStatus.className = "success";
    }
    
    // Auto-login after successful registration
    setTimeout(() => {
      if (usernameInput) usernameInput.value = "";
      if (emailInput) emailInput.value = "";
      if (passwordInput) passwordInput.value = "";
      if (displayNameInput) displayNameInput.value = "";
      showLoginForm();
      
      // Pre-fill username for login
      const loginUsernameInput = document.querySelector("#login-username") as HTMLInputElement;
      if (loginUsernameInput) loginUsernameInput.value = user.username;
    }, 1500);
    
  } catch (error) {
    if (registerStatus) {
      registerStatus.textContent = `Registrering feilet: ${error}`;
      registerStatus.className = "error";
    }
    console.error("Registration failed:", error);
  } finally {
    if (registerBtn) registerBtn.disabled = false;
  }
}

function showLoginForm() {
  const loginForm = document.querySelector("#login-form") as HTMLElement;
  const registerForm = document.querySelector("#register-form") as HTMLElement;
  
  if (loginForm) loginForm.style.display = "block";
  if (registerForm) registerForm.style.display = "none";
}

function showRegisterForm() {
  const loginForm = document.querySelector("#login-form") as HTMLElement;
  const registerForm = document.querySelector("#register-form") as HTMLElement;
  
  if (loginForm) loginForm.style.display = "none";
  if (registerForm) registerForm.style.display = "block";
}

async function handleLogout() {
  const backendUrl = (document.querySelector("#backend-url") as HTMLInputElement)?.value || "http://localhost:8000";
  
  try {
    if (authToken) {
      await invoke("logout", {
        backendUrl,
        authToken
      });
    }
  } catch (error) {
    console.error("Logout failed:", error);
  }
  
  // Clear credentials
  authToken = null;
  currentUser = null;
  if (credentialsStore) {
    await credentialsStore.delete("auth_token");
    await credentialsStore.save();
  }
  
  showLoginScreen();
}

function showLoginScreen() {
  const loginScreen = document.querySelector("#login-screen") as HTMLElement;
  const mainScreen = document.querySelector("#main-screen") as HTMLElement;
  
  if (loginScreen) loginScreen.style.display = "block";
  if (mainScreen) mainScreen.style.display = "none";
}

function showMainScreen() {
  const loginScreen = document.querySelector("#login-screen") as HTMLElement;
  const mainScreen = document.querySelector("#main-screen") as HTMLElement;
  const userInfo = document.querySelector("#user-info");
  
  if (loginScreen) loginScreen.style.display = "none";
  if (mainScreen) mainScreen.style.display = "block";
  if (userInfo && currentUser) {
    const displayName = currentUser.display_name || currentUser.username;
    userInfo.textContent = `Innlogget som: ${displayName} (${currentUser.username})`;
  }
}

async function openWebGallery() {
  try {
    await invoke("open_web_gallery", {
      token: authToken
    });
  } catch (error) {
    console.error("Failed to open gallery:", error);
    alert(`Kunne ikke åpne galleri: ${error}`);
  }
}

async function loadInputChannels() {
  const backendUrlInput = document.querySelector("#backend-url") as HTMLInputElement;
  const backendUrl = backendUrlInput?.value || "https://api.trollfjell.com";
  
  if (!authToken) {
    alert("Du må være innlogget");
    return;
  }

  try {
    const channels: InputChannel[] = await invoke("list_input_channels", {
      backendUrl,
      authToken
    });

    const selector = document.querySelector("#existing-channels") as HTMLSelectElement;
    const channelSelectorDiv = document.querySelector("#channel-selector") as HTMLElement;
    
    selector.innerHTML = '<option value="">-- Velg kanal --</option>';
    
    // Filter out protected channels (Quick Channel)
    const userChannels = channels.filter(ch => ch.title !== "Quick Channel" && !ch.title?.includes("Quick"));
    
    userChannels.forEach(channel => {
      const option = document.createElement("option");
      option.value = channel.id.toString();
      option.textContent = `${channel.title || "Uten tittel"} (${channel.images_count || 0} bilder)`;
      selector.appendChild(option);
    });

    channelSelectorDiv.style.display = "block";

    if (userChannels.length === 0) {
      alert("Ingen kanaler funnet. Opprett en ny kanal.");
    }
  } catch (error) {
    console.error("Failed to load channels:", error);
    alert(`Kunne ikke laste kanaler: ${error}`);
  }
}

function showCreateChannelForm() {
  const form = document.querySelector("#create-channel-form") as HTMLElement;
  form.style.display = "block";
}

async function createNewChannel() {
  const backendUrlInput = document.querySelector("#backend-url") as HTMLInputElement;
  const titleInput = document.querySelector("#session-title") as HTMLInputElement;
  const descriptionInput = document.querySelector("#session-description") as HTMLTextAreaElement;

  const backendUrl = backendUrlInput?.value || "https://api.trollfjell.com";
  const title = titleInput?.value.trim();
  const description = descriptionInput?.value.trim() || null;

  if (!title) {
    alert("Tittel er påkrevd");
    return;
  }

  if (!authToken) {
    alert("Du må være innlogget");
    return;
  }

  try {
    const channel: InputChannel = await invoke("create_input_channel", {
      backendUrl,
      title,
      description,
      defaultAuthorId: null,
      authToken
    });

    selectedInputChannelId = channel.id;

    // Update UI
    const form = document.querySelector("#create-channel-form") as HTMLElement;
    const infoDiv = document.querySelector("#selected-channel-info") as HTMLElement;
    const nameSpan = document.querySelector("#selected-channel-name");

    form.style.display = "none";
    infoDiv.style.display = "block";
    if (nameSpan) {
      nameSpan.textContent = `${channel.title} (ID: ${channel.id})`;
    }

    // Clear form
    titleInput.value = "";
    descriptionInput.value = "";

    alert(`Kanal "${channel.title}" opprettet!`);
  } catch (error) {
    console.error("Failed to create channel:", error);
    alert(`Kunne ikke opprette kanal: ${error}`);
  }
}

// ===== Import Mode Functions =====

function handleImportModeChange() {
  const copyRadio = document.querySelector('input[name="import-mode"][value="copy"]') as HTMLInputElement;
  const copySettingsDiv = document.querySelector("#copy-settings") as HTMLElement;
  const registerSourceDiv = document.querySelector("#register-source") as HTMLElement;
  
  const isCopyMode = copyRadio?.checked || false;
  
  if (copySettingsDiv) {
    copySettingsDiv.style.display = isCopyMode ? "block" : "none";
  }
  
  if (registerSourceDiv) {
    registerSourceDiv.style.display = isCopyMode ? "none" : "block";
  }
}

async function selectRegisterSourceDirectory() {
  try {
    const selected = await open({
      multiple: false,
      directory: true,
      title: "Velg katalog med bilder (permanent lokasjon)"
    });
    
    if (selected) {
      const input = document.querySelector("#register-source-path") as HTMLInputElement;
      if (input) {
        input.value = selected as string;
      }
      // Auto-trigger directory scanning
      selectedDirPath = selected as string;
      await scanDirectory(selectedDirPath);
    }
  } catch (error) {
    console.error("Failed to select register source directory:", error);
  }
}

async function selectCopySourceDirectory() {
  try {
    const selected = await open({
      multiple: false,
      directory: true,
      title: "Velg kildekatalog (midlertidig lokasjon)"
    });
    
    if (selected) {
      const input = document.querySelector("#copy-source-path") as HTMLInputElement;
      if (input) {
        input.value = selected as string;
      }
      // Auto-trigger directory scanning
      selectedDirPath = selected as string;
      await scanDirectory(selectedDirPath);
    }
  } catch (error) {
    console.error("Failed to select copy source directory:", error);
  }
}

async function selectDestinationDirectory() {
  try {
    const selected = await open({
      multiple: false,
      directory: true,
      title: "Velg destinasjonskatalog (permanent lagring)"
    });
    
    if (selected) {
      const input = document.querySelector("#destination-path") as HTMLInputElement;
      if (input) {
        input.value = selected as string;
      }
    }
  } catch (error) {
    console.error("Failed to select destination directory:", error);
    alert(`Kunne ikke velge katalog: ${error}`);
  }
}

function selectExistingChannel() {
  const selector = document.querySelector("#existing-channels") as HTMLSelectElement;
  const selectedValue = selector.value;

  if (!selectedValue) {
    selectedInputChannelId = null;
    const infoDiv = document.querySelector("#selected-channel-info") as HTMLElement;
    infoDiv.style.display = "none";
    return;
  }

  selectedInputChannelId = parseInt(selectedValue);

  const selectedOption = selector.options[selector.selectedIndex];
  const channelName = selectedOption.textContent || "";

  const infoDiv = document.querySelector("#selected-channel-info") as HTMLElement;
  const nameSpan = document.querySelector("#selected-channel-name");

  infoDiv.style.display = "block";
  if (nameSpan) {
    nameSpan.textContent = channelName;
  }
}

window.addEventListener("DOMContentLoaded", () => {
  // Initialize authentication
  initializeAuth();
  
  // Main screen event listeners
  const startImportBtn = document.querySelector("#start-import");
  const openGalleryBtn = document.querySelector("#open-gallery-btn");
  const logoutBtn = document.querySelector("#logout-btn");
  const testCoreBtn = document.querySelector("#test-core-btn");
  
  // Input channel event listeners
  const loadChannelsBtn = document.querySelector("#load-channels-btn");
  const showCreateChannelBtn = document.querySelector("#show-create-channel-btn");
  const createChannelBtn = document.querySelector("#create-channel-btn");
  const existingChannelsSelect = document.querySelector("#existing-channels");
  
  // Remove old select-dir button - replaced by mode-specific buttons
  startImportBtn?.addEventListener("click", startImport);
  openGalleryBtn?.addEventListener("click", openWebGallery);
  logoutBtn?.addEventListener("click", handleLogout);
  testCoreBtn?.addEventListener("click", checkCoreHealth);
  
  loadChannelsBtn?.addEventListener("click", loadInputChannels);
  showCreateChannelBtn?.addEventListener("click", showCreateChannelForm);
  createChannelBtn?.addEventListener("click", createNewChannel);
  existingChannelsSelect?.addEventListener("change", selectExistingChannel);
  
  // Import mode event listeners
  const importModeRadios = document.querySelectorAll('input[name="import-mode"]');
  const selectRegisterSourceBtn = document.querySelector("#select-register-source-btn");
  const selectCopySourceBtn = document.querySelector("#select-copy-source-btn");
  const selectDestinationBtn = document.querySelector("#select-destination-btn");
  
  importModeRadios.forEach(radio => {
    radio.addEventListener("change", handleImportModeChange);
  });
  selectRegisterSourceBtn?.addEventListener("click", selectRegisterSourceDirectory);
  selectCopySourceBtn?.addEventListener("click", selectCopySourceDirectory);
  selectDestinationBtn?.addEventListener("click", selectDestinationDirectory);
  
  // Initialize import mode UI
  handleImportModeChange();
  
  // Login screen event listeners
  const loginBtn = document.querySelector("#login-btn");
  const loginForm = document.querySelector("#login-form");
  const registerBtn = document.querySelector("#register-btn");
  const registerForm = document.querySelector("#register-form");
  const showRegisterLink = document.querySelector("#show-register");
  const showLoginLink = document.querySelector("#show-login");
  
  loginBtn?.addEventListener("click", handleLogin);
  loginForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    handleLogin();
  });
  
  registerBtn?.addEventListener("click", handleRegister);
  registerForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    handleRegister();
  });
  
  showRegisterLink?.addEventListener("click", (e) => {
    e.preventDefault();
    showRegisterForm();
  });
  
  showLoginLink?.addEventListener("click", (e) => {
    e.preventDefault();
    showLoginForm();
  });
});
