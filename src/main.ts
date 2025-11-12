import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Store } from "@tauri-apps/plugin-store";

// ===== Authentication Interfaces =====

interface User {
  id: number;
  username: string;
  email: string;
  display_name: string;
  is_active: boolean;
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

// PhotoEgg structure - matches imalink-core v2.0 API response
interface PhotoEgg {
  // Identity
  hothash: string;
  
  // Hotpreview (always present)
  hotpreview_base64: string;
  hotpreview_width: number;
  hotpreview_height: number;
  
  // Coldpreview (optional)
  coldpreview_base64?: string | null;
  coldpreview_width?: number | null;
  coldpreview_height?: number | null;
  
  // File info
  primary_filename: string;
  width: number;
  height: number;
  
  // Timestamps
  taken_at?: string | null;
  
  // Camera metadata
  camera_make?: string | null;
  camera_model?: string | null;
  
  // GPS
  gps_latitude?: number | null;
  gps_longitude?: number | null;
  has_gps: boolean;
  
  // Camera settings
  iso?: number | null;
  aperture?: number | null;
  shutter_speed?: string | null;
  focal_length?: number | null;
  lens_model?: string | null;
  lens_make?: string | null;
}

// ImportSession structure - matches imalink backend API v2.3
interface ImportSession {
  id: number;
  user_id: number;
  title: string;
  description?: string | null;
  is_protected: boolean;  // New in v2.3 - cannot delete if true
  photo_count: number;
  created_at: string;
  updated_at: string;
}

// PhotoEgg upload response - API v2.3
interface PhotoEggResponse {
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
  updated_at: string;
}

let selectedFiles: string[] = [];
let selectedDirPath: string | null = null;

async function selectDirectory() {
  const statusEl = document.querySelector("#status");
  const selectedDirEl = document.querySelector("#selected-dir");
  const fileListEl = document.querySelector("#file-list") as HTMLElement;
  const filesEl = document.querySelector("#files");
  const startImportBtn = document.querySelector("#start-import") as HTMLButtonElement;
  
  try {
    const dir = await open({
      multiple: false,
      directory: true
    });

    if (dir) {
      selectedDirPath = dir as string;
      if (selectedDirEl) {
        selectedDirEl.textContent = `Valgt: ${selectedDirPath}`;
      }
      if (statusEl) {
        statusEl.textContent = "Skanner katalog...";
        statusEl.className = "loading";
      }
      
      // Scan directory for JPEG files
      selectedFiles = await invoke("scan_directory", {
        dirPath: selectedDirPath
      });
      
      if (filesEl) {
        filesEl.innerHTML = `<p>Funnet ${selectedFiles.length} JPEG-filer</p>`;
        if (selectedFiles.length > 0) {
          const fileList = selectedFiles.slice(0, 10).map(f => `<li>${f}</li>`).join('');
          filesEl.innerHTML += `<ul>${fileList}${selectedFiles.length > 10 ? `<li>... og ${selectedFiles.length - 10} flere</li>` : ''}</ul>`;
        }
      }
      
      if (fileListEl) {
        fileListEl.style.display = selectedFiles.length > 0 ? "block" : "none";
      }
      
      if (startImportBtn) {
        startImportBtn.disabled = selectedFiles.length === 0;
      }
      
      if (statusEl) {
        statusEl.textContent = selectedFiles.length > 0 ? `✓ Funnet ${selectedFiles.length} filer` : "Ingen JPEG-filer funnet";
        statusEl.className = selectedFiles.length > 0 ? "success" : "error";
      }
    }
  } catch (error) {
    if (statusEl) {
      statusEl.textContent = `Feil ved katalogvalg: ${error}`;
      statusEl.className = "error";
    }
    console.error("Failed to select directory:", error);
  }
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
  const titleInput = document.querySelector("#session-title") as HTMLInputElement;
  const descriptionInput = document.querySelector("#session-description") as HTMLTextAreaElement;
  const authorIdInput = document.querySelector("#author-id") as HTMLInputElement;

  const coreApiUrl = coreUrlInput?.value || "http://localhost:8765";
  const backendUrl = backendUrlInput?.value || "http://localhost:8000";
  const title = titleInput?.value || null;
  const description = descriptionInput?.value || null;
  const authorId = authorIdInput?.value ? parseInt(authorIdInput.value) : null;

  if (!authToken) {
    if (statusEl) {
      statusEl.textContent = "Feil: Du må være innlogget";
      statusEl.className = "error";
    }
    return;
  }

  startImportBtn.disabled = true;

  try {
    // Step 1: Create import session
    if (statusEl) {
      statusEl.textContent = "Oppretter import session...";
      statusEl.className = "loading";
    }

    const importSession: ImportSession = await invoke("create_import_session", {
      backendUrl,
      title,
      description,
      defaultAuthorId: authorId,
      authToken
    });

    if (statusEl) {
      statusEl.textContent = `✓ Import session opprettet (ID: ${importSession.id})`;
      statusEl.className = "success";
    }

    // Step 2: Process each file
    if (progressEl) {
      progressEl.style.display = "block";
    }
    if (resultsEl) {
      resultsEl.style.display = "block";
    }

    const results: { file: string; success: boolean; error?: string; hothash?: string }[] = [];

    for (let i = 0; i < selectedFiles.length; i++) {
      const filePath = selectedFiles[i];
      const fileName = filePath.split('/').pop() || filePath;
      
      // Update progress
      const progress = ((i + 1) / selectedFiles.length) * 100;
      if (progressFillEl) {
        progressFillEl.style.width = `${progress}%`;
      }
      if (progressTextEl) {
        progressTextEl.textContent = `Behandler fil ${i + 1} av ${selectedFiles.length}: ${fileName}`;
      }

      try {
        // Step 2a: Send to imalink-core to get PhotoEgg
        const photoEgg: PhotoEgg = await invoke("process_image_file", {
          filePath,
          coreApiUrl
        });

        // Step 2b: Upload PhotoEgg to backend
        const uploadResult: PhotoEggResponse = await invoke("upload_photoegg", {
          backendUrl,
          photoEgg,
          importSessionId: importSession.id,
          authToken
        });

        results.push({
          file: fileName,
          success: true,
          hothash: uploadResult.hothash
        });
      } catch (error) {
        results.push({
          file: fileName,
          success: false,
          error: String(error)
        });
      }
    }

    // Step 3: Show results
    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    if (statusEl) {
      statusEl.textContent = `Import fullført: ${successCount} suksess, ${failCount} feil`;
      statusEl.className = failCount === 0 ? "success" : "warning";
    }

    if (resultsContentEl) {
      let html = `<h3>Sammendrag</h3>`;
      html += `<p><strong>Total:</strong> ${selectedFiles.length} filer</p>`;
      html += `<p><strong>Suksess:</strong> ${successCount}</p>`;
      html += `<p><strong>Feil:</strong> ${failCount}</p>`;
      html += `<p><strong>Import Session ID:</strong> ${importSession.id}</p>`;
      html += `<p><strong>Import Session:</strong> ${importSession.title}</p>`;
      
      if (failCount > 0) {
        html += `<h3>Feil:</h3><ul>`;
        results.filter(r => !r.success).forEach(r => {
          html += `<li><strong>${r.file}:</strong> ${r.error}</li>`;
        });
        html += `</ul>`;
      }

      html += `<details><summary>Alle filer (klikk for å utvide)</summary><ul>`;
      results.forEach(r => {
        html += `<li>${r.success ? '✓' : '✗'} ${r.file}${r.hothash ? ` (${r.hothash.substring(0, 8)}...)` : ''}</li>`;
      });
      html += `</ul></details>`;

      resultsContentEl.innerHTML = html;
    }

  } catch (error) {
    if (statusEl) {
      statusEl.textContent = `Feil: ${error}`;
      statusEl.className = "error";
    }
    console.error("Import failed:", error);
  } finally {
    startImportBtn.disabled = false;
  }
}

// ===== Authentication Functions =====

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
    userInfo.textContent = `Innlogget som: ${currentUser.display_name} (${currentUser.username})`;
  }
}

window.addEventListener("DOMContentLoaded", () => {
  // Initialize authentication
  initializeAuth();
  
  // Main screen event listeners
  const selectDirBtn = document.querySelector("#select-dir");
  const startImportBtn = document.querySelector("#start-import");
  const logoutBtn = document.querySelector("#logout-btn");
  
  selectDirBtn?.addEventListener("click", selectDirectory);
  startImportBtn?.addEventListener("click", startImport);
  logoutBtn?.addEventListener("click", handleLogout);
  
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
