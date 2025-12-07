use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::fs;
use tauri::{WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_shell::ShellExt;

// ===== Authentication Structures =====

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct User {
    pub id: i32,
    pub username: String,
    pub email: String,
    pub display_name: Option<String>,  // Can be null from backend
    pub is_active: bool,
    #[serde(default)]
    pub default_author_id: Option<i32>,  // NEW in v2.3 - points to user's self-author
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LoginResponse {
    pub access_token: String,
    pub token_type: String,
    pub user: User,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RegisterRequest {
    pub username: String,
    pub email: String,
    pub password: String,
    pub display_name: String,
}

// PhotoCreateSchema structure - matches imalink-core v2.x API response
// See: https://github.com/kjelkols/imalink-core/blob/main/service/main.py
// This is the canonical format from imalink-core API v2.x+ (replaces legacy PhotoEgg)
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default)]  // Allow missing optional fields
pub struct PhotoCreateSchema {
    // Identity (required)
    pub hothash: String,
    
    // Hotpreview (always present)
    pub hotpreview_base64: String,
    pub hotpreview_width: i32,
    pub hotpreview_height: i32,
    
    // Coldpreview (optional)
    pub coldpreview_base64: Option<String>,
    pub coldpreview_width: Option<i32>,
    pub coldpreview_height: Option<i32>,
    
    // File info (required)
    pub width: i32,
    pub height: i32,
    
    // Timestamps (optional)
    pub taken_at: Option<String>,
    
    // GPS (optional)
    pub gps_latitude: Option<f64>,
    pub gps_longitude: Option<f64>,
    
    // NEW in v2.x: Complete EXIF metadata in flexible JSON object
    #[serde(default)]
    pub exif_dict: serde_json::Value,  // JSON object with all EXIF data
    
    // NEW in v2.x: List of source image files
    #[serde(default)]
    pub image_file_list: Vec<ImageFileSchema>,
    
    // Organization fields (added by desktop before upload)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_channel_id: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rating: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub visibility: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author_id: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stack_id: Option<i32>,
}

// ImageFile schema from imalink-core response
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ImageFileSchema {
    pub filename: String,
    #[serde(default)]
    pub file_size: i64,
    #[serde(default)]
    pub format: Option<String>,
    #[serde(default)]
    pub is_raw: bool,
    #[serde(default)]
    pub local_storage_info: Option<serde_json::Value>,
    #[serde(default)]
    pub imported_info: Option<serde_json::Value>,
}

impl Default for PhotoCreateSchema {
    fn default() -> Self {
        PhotoCreateSchema {
            hothash: String::new(),
            hotpreview_base64: String::new(),
            hotpreview_width: 0,
            hotpreview_height: 0,
            coldpreview_base64: None,
            coldpreview_width: None,
            coldpreview_height: None,
            width: 0,
            height: 0,
            taken_at: None,
            gps_latitude: None,
            gps_longitude: None,
            exif_dict: serde_json::Value::Object(serde_json::Map::new()),
            image_file_list: Vec::new(),
            input_channel_id: None,
            rating: None,
            visibility: None,
            category: None,
            author_id: None,
            stack_id: None,
        }
    }
}

// InputChannel structure - matches imalink backend API actual response
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct InputChannel {
    pub id: i32,
    pub imported_at: String,
    pub title: Option<String>,  // Can be null from backend
    pub description: Option<String>,
    pub default_author_id: Option<i32>,
    pub images_count: i32,
}

// Wrapper for list response from backend
#[derive(Debug, Serialize, Deserialize)]
struct InputChannelListResponse {
    pub channels: Vec<InputChannel>,
    pub total: i32,
}

// Structure for creating input channel
#[derive(Debug, Serialize, Deserialize)]
pub struct InputChannelCreate {
    pub title: Option<String>,
    pub description: Option<String>,
    pub default_author_id: Option<i32>,
}

// ImageFile tracking metadata (optional, for desktop app)
#[derive(Debug, Serialize, Deserialize)]
pub struct ImageFileCreate {
    pub filename: String,
    pub file_path: String,
    pub file_size: i64,
    pub file_format: String,
    
    // File handling metadata (flexible JSON structure)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_storage_info: Option<serde_json::Value>,
    
    #[serde(skip_serializing_if = "Option::is_none")]
    pub imported_info: Option<serde_json::Value>,
}

// Structure for PhotoCreateSchema upload request - API v2.4
#[derive(Debug, Serialize, Deserialize)]
pub struct PhotoCreateRequest {
    pub photo_create_schema: PhotoCreateSchema,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_channel_id: Option<i32>,  // Optional - defaults to protected "Quick Channel"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image_file: Option<ImageFileCreate>,  // Optional - for desktop app file tracking
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rating: Option<i32>,  // 0-5 stars
    #[serde(skip_serializing_if = "Option::is_none")]
    pub visibility: Option<String>,  // private|space|authenticated|public
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author_id: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,  // New in v2.3 - user-defined category
}

// Structure for PhotoCreateSchema upload response - API v2.4
#[derive(Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct PhotoCreateResponse {
    pub id: i32,
    pub hothash: String,
    pub user_id: i32,
    pub width: i32,
    pub height: i32,
    pub taken_at: Option<String>,
    #[serde(default)]
    pub gps_latitude: Option<f64>,
    #[serde(default)]
    pub gps_longitude: Option<f64>,
    pub rating: i32,
    #[serde(default)]
    pub category: Option<String>,
    pub visibility: String,
    pub created_at: String,
    #[serde(default)]
    pub updated_at: Option<String>,  // Optional - backend may not return it
    #[serde(default)]
    pub is_duplicate: bool,  // NEW in API v2.4 - indicates if photo already existed
}

impl Default for PhotoCreateResponse {
    fn default() -> Self {
        PhotoCreateResponse {
            id: 0,
            hothash: String::new(),
            user_id: 0,
            width: 0,
            height: 0,
            taken_at: None,
            gps_latitude: None,
            gps_longitude: None,
            rating: 0,
            category: None,
            visibility: "private".to_string(),
            created_at: String::new(),
            updated_at: None,
            is_duplicate: false,
        }
    }
}


// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
async fn process_image_file(file_path: String, core_api_url: String) -> Result<PhotoCreateSchema, String> {
    let path = PathBuf::from(&file_path);
    
    if !path.exists() {
        return Err(format!("File not found: {}", file_path));
    }

    let file_bytes = std::fs::read(&path)
        .map_err(|e| format!("Failed to read file: {}", e))?;

    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("Invalid filename")?
        .to_string();

    let client = reqwest::Client::new();
    let form = reqwest::multipart::Form::new()
        .part(
            "file",
            reqwest::multipart::Part::bytes(file_bytes)
                .file_name(file_name.clone())
                .mime_str("image/*")
                .map_err(|e| format!("Failed to set mime type: {}", e))?,
        )
        .text("coldpreview_size", "1200"); // Request coldpreview with max 1200px

    let response = client
        .post(format!("{}/v1/process", core_api_url))
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("Failed to send request to core API: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "Core API returned error: {}",
            response.status()
        ));
    }

    let response_text = response.text().await
        .map_err(|e| format!("Failed to read response: {}", e))?;
    let photo_create_schema: PhotoCreateSchema = serde_json::from_str(&response_text)
        .map_err(|e| format!("Failed to parse PhotoCreateSchema response: {} | Response start: {}", e, 
                            if response_text.len() > 500 { &response_text[..500] } else { &response_text }))?;

    Ok(photo_create_schema)
}

// Get file size in bytes
#[tauri::command]
fn get_file_size(file_path: String) -> Result<i64, String> {
    let path = PathBuf::from(&file_path);
    
    if !path.exists() {
        return Err(format!("File not found: {}", file_path));
    }
    
    let metadata = fs::metadata(&path)
        .map_err(|e| format!("Failed to get file metadata: {}", e))?;
    
    Ok(metadata.len() as i64)
}

// Copy file to destination directory with optional structure preservation
#[tauri::command]
fn copy_file_to_storage(
    source_path: String,
    destination_dir: String,
    preserve_structure: bool,
    source_base_dir: Option<String>
) -> Result<String, String> {
    let source = PathBuf::from(&source_path);
    let dest_dir = PathBuf::from(&destination_dir);
    
    if !source.exists() {
        return Err(format!("Source file not found: {}", source_path));
    }
    
    if !source.is_file() {
        return Err(format!("Source is not a file: {}", source_path));
    }
    
    if !dest_dir.exists() {
        fs::create_dir_all(&dest_dir)
            .map_err(|e| format!("Failed to create destination directory: {}", e))?;
    }
    
    // Determine final destination path
    let dest_path = if preserve_structure && source_base_dir.is_some() {
        // Preserve directory structure relative to base
        let base = PathBuf::from(source_base_dir.unwrap());
        let relative = source.strip_prefix(&base)
            .map_err(|_| "Source path not under base directory".to_string())?;
        let final_dest = dest_dir.join(relative);
        
        // Create parent directories if needed
        if let Some(parent) = final_dest.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create parent directories: {}", e))?;
        }
        
        final_dest
    } else {
        // Flat copy - just filename
        let filename = source.file_name()
            .ok_or("Invalid source filename")?;
        dest_dir.join(filename)
    };
    
    // Check if destination exists
    if dest_path.exists() {
        return Err(format!("Destination file already exists: {}", dest_path.display()));
    }
    
    // Copy file
    fs::copy(&source, &dest_path)
        .map_err(|e| format!("Failed to copy file: {}", e))?;
    
    // Return destination path as string
    Ok(dest_path.to_string_lossy().to_string())
}

#[tauri::command]
fn scan_directory(dir_path: String) -> Result<Vec<String>, String> {
    let path = PathBuf::from(&dir_path);
    
    if !path.exists() {
        return Err(format!("Directory not found: {}", dir_path));
    }
    
    if !path.is_dir() {
        return Err(format!("Path is not a directory: {}", dir_path));
    }
    
    let mut image_files: Vec<String> = Vec::new();
    
    // Supported image extensions for companion detection
    let supported_extensions = vec![
        // JPEG formats (master priority 1)
        "jpg", "jpeg",
        // HEIC format (master priority 2)
        "heic", "heif",
        // PNG format (master priority 3)
        "png",
        // RAW formats (master priority 10)
        "arw", "cr2", "cr3", "nef", "dng", "orf", "raf", "rw2", "raw"
    ];
    
    // Recursive function to scan directories
    fn scan_recursive(path: &PathBuf, files: &mut Vec<String>, extensions: &Vec<&str>) -> Result<(), String> {
        let entries = fs::read_dir(path)
            .map_err(|e| format!("Failed to read directory: {}", e))?;
        
        for entry in entries {
            let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
            let entry_path = entry.path();
            
            if entry_path.is_dir() {
                // Recurse into subdirectory
                scan_recursive(&entry_path, files, extensions)?;
            } else if entry_path.is_file() {
                // Check if it's a supported image file
                if let Some(ext) = entry_path.extension() {
                    let ext_lower = ext.to_string_lossy().to_lowercase();
                    if extensions.contains(&ext_lower.as_str()) {
                        if let Some(path_str) = entry_path.to_str() {
                            files.push(path_str.to_string());
                        }
                    }
                }
            }
        }
        
        Ok(())
    }
    
    scan_recursive(&path, &mut image_files, &supported_extensions)?;
    
    // Sort files for consistent ordering
    image_files.sort();
    
    Ok(image_files)
}

#[tauri::command]
async fn list_input_channels(
    backend_url: String,
    auth_token: String,
) -> Result<Vec<InputChannel>, String> {
    let client = reqwest::Client::new();
    
    let response = client
        .get(format!("{}/api/v1/input-channels/", backend_url))
        .header("Authorization", format!("Bearer {}", auth_token))
        .send()
        .await
        .map_err(|e| format!("Failed to send request to backend: {}", e))?;
    
    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!(
            "Backend returned error {}: {}",
            status, error_text
        ));
    }
    
    let response_text = response.text().await
        .map_err(|e| format!("Failed to read response: {}", e))?;
    
    let response_data: InputChannelListResponse = serde_json::from_str(&response_text)
        .map_err(|e| format!("Failed to parse response: {} | Response was: {}", e, response_text))?;
    
    Ok(response_data.channels)
}

#[tauri::command]
async fn create_input_channel(
    backend_url: String,
    title: Option<String>,
    description: Option<String>,
    default_author_id: Option<i32>,
    auth_token: String,
) -> Result<InputChannel, String> {
    let client = reqwest::Client::new();
    
    let request_body = InputChannelCreate {
        title,
        description,
        default_author_id,
    };
    
    let response = client
        .post(format!("{}/api/v1/input-channels/", backend_url))
        .header("Authorization", format!("Bearer {}", auth_token))
        .header("Content-Type", "application/json")
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("Failed to send request to backend: {}", e))?;
    
    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!(
            "Backend returned error {}: {}",
            status, error_text
        ));
    }
    
    let response_text = response.text().await
        .map_err(|e| format!("Failed to read response: {}", e))?;
    
    let input_channel: InputChannel = serde_json::from_str(&response_text)
        .map_err(|e| format!("Failed to parse response: {} | Response was: {}", e, response_text))?;
    
    Ok(input_channel)
}

#[tauri::command]
async fn upload_photo_create_schema(
    backend_url: String,
    photo_create_schema: PhotoCreateSchema,
    input_channel_id: i32,
    auth_token: String,
) -> Result<PhotoCreateResponse, String> {
    let client = reqwest::Client::new();
    
    // PhotoCreateSchema now contains complete image_file_list from frontend
    // No need to build image_file separately - it's already in photo_create_schema.image_file_list
    
    let request_body = PhotoCreateRequest {
        photo_create_schema,
        input_channel_id: Some(input_channel_id),
        image_file: None,  // Deprecated - data is now in photo_create_schema.image_file_list
        rating: Some(0),  // Default rating
        visibility: Some("private".to_string()),  // Default visibility
        author_id: None,
        category: None,
    };
    
    // Log upload
    println!("Uploading photo (hothash: {}) to channel {}", 
             request_body.photo_create_schema.hothash, 
             input_channel_id);
    
    let response = client
        .post(format!("{}/api/v1/photos/create", backend_url))
        .header("Authorization", format!("Bearer {}", auth_token))
        .header("Content-Type", "application/json")
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("Failed to send request to backend: {}", e))?;
    
    let status = response.status();
    
    // Handle 409 Conflict (duplicate) as success
    if status == reqwest::StatusCode::CONFLICT {
        let response_text = response.text().await
            .map_err(|e| format!("Failed to read response: {}", e))?;
        
        let mut photo_response: PhotoCreateResponse = serde_json::from_str(&response_text)
            .map_err(|e| format!("Failed to parse duplicate response: {} | Response was: {}", e, response_text))?;
        
        // Ensure is_duplicate is set to true
        photo_response.is_duplicate = true;
        return Ok(photo_response);
    }
    
    if !status.is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!(
            "Backend returned error {}: {}",
            status, error_text
        ));
    }
    
    let response_text = response.text().await
        .map_err(|e| format!("Failed to read response: {}", e))?;
    
    let photo_response: PhotoCreateResponse = serde_json::from_str(&response_text)
        .map_err(|e| format!("Failed to parse response: {} | Response was: {}", e, response_text))?;
    
    Ok(photo_response)
}

// ===== Authentication Commands =====

#[tauri::command]
async fn login(
    backend_url: String,
    username: String,
    password: String,
) -> Result<LoginResponse, String> {
    let client = reqwest::Client::new();
    
    let request_body = LoginRequest {
        username,
        password,
    };
    
    let response = client
        .post(format!("{}/api/v1/auth/login/", backend_url))
        .header("Content-Type", "application/json")
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("Failed to connect to server: {}", e))?;
    
    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!(
            "Login failed ({}): {}",
            status,
            if error_text.is_empty() { "Invalid credentials" } else { &error_text }
        ));
    }
    
    let login_response: LoginResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse login response: {}", e))?;
    
    Ok(login_response)
}

#[tauri::command]
async fn register(
    backend_url: String,
    username: String,
    email: String,
    password: String,
    display_name: String,
) -> Result<User, String> {
    let client = reqwest::Client::new();
    
    let request_body = RegisterRequest {
        username,
        email,
        password,
        display_name,
    };
    
    let response = client
        .post(format!("{}/api/v1/auth/register/", backend_url))
        .header("Content-Type", "application/json")
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("Failed to connect to server: {}", e))?;
    
    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!(
            "Registration failed ({}): {}",
            status,
            if error_text.is_empty() { "Registration error" } else { &error_text }
        ));
    }
    
    let user: User = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse registration response: {}", e))?;
    
    Ok(user)
}

#[tauri::command]
async fn logout(
    backend_url: String,
    auth_token: String,
) -> Result<(), String> {
    let client = reqwest::Client::new();
    
    let response = client
        .post(format!("{}/api/v1/auth/logout/", backend_url))
        .header("Authorization", format!("Bearer {}", auth_token))
        .send()
        .await
        .map_err(|e| format!("Failed to connect to server: {}", e))?;
    
    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!(
            "Logout failed ({}): {}",
            status, error_text
        ));
    }
    
    Ok(())
}

#[tauri::command]
async fn validate_token(
    backend_url: String,
    auth_token: String,
) -> Result<User, String> {
    let client = reqwest::Client::new();
    
    let response = client
        .get(format!("{}/api/v1/auth/me/", backend_url))
        .header("Authorization", format!("Bearer {}", auth_token))
        .send()
        .await
        .map_err(|e| format!("Failed to connect to server: {}", e))?;
    
    if !response.status().is_success() {
        let status = response.status();
        return Err(format!("Token validation failed: {}", status));
    }
    
    let user: User = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse user response: {}", e))?;
    
    Ok(user)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|app| {
            // Start imalink-core sidecar on app startup
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = start_core_server(app_handle).await {
                    eprintln!("Failed to start imalink-core: {}", e);
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet, 
            process_image_file, 
            scan_directory,
            get_file_size,
            copy_file_to_storage,
            list_input_channels,
            create_input_channel,
            upload_photo_create_schema,
            login,
            register,
            logout,
            validate_token,
            check_core_health,
            open_web_gallery
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// ===== Core Server Management =====

async fn start_core_server(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_shell::process::CommandEvent;
    
    println!("Starting imalink-core server on port 8765...");
    
    let sidecar_command = app.shell()
        .sidecar("imalink-core")
        .map_err(|e| {
            let err_msg = format!("Failed to create sidecar command: {}", e);
            eprintln!("{}", err_msg);
            err_msg
        })?;
    
    println!("Spawning imalink-core process...");
    let (mut rx, child) = sidecar_command
        .spawn()
        .map_err(|e| {
            let err_msg = format!("Failed to spawn imalink-core: {}", e);
            eprintln!("{}", err_msg);
            err_msg
        })?;
    
    println!("imalink-core process spawned with PID: {:?}", child.pid());
    
    // Listen to core output in background
    tauri::async_runtime::spawn(async move {
        println!("Starting imalink-core output listener...");
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let output = String::from_utf8_lossy(&line);
                    println!("[imalink-core stdout] {}", output);
                }
                CommandEvent::Stderr(line) => {
                    let output = String::from_utf8_lossy(&line);
                    eprintln!("[imalink-core stderr] {}", output);
                }
                CommandEvent::Terminated(payload) => {
                    eprintln!("[imalink-core] Process terminated with code: {:?}", payload.code);
                    if let Some(code) = payload.code {
                        if code != 0 {
                            eprintln!("[imalink-core] Non-zero exit code indicates error!");
                        }
                    }
                    break;
                }
                CommandEvent::Error(err) => {
                    eprintln!("[imalink-core] Process error: {}", err);
                }
                _ => {}
            }
        }
        println!("imalink-core output listener terminated");
    });
    
    println!("✓ imalink-core server started successfully on http://localhost:8765");
    Ok(())
}

// ===== Web Gallery Integration =====

#[tauri::command]
async fn check_core_health(core_api_url: String) -> Result<String, String> {
    let client = reqwest::Client::new();
    let health_url = format!("{}/health", core_api_url);
    
    println!("Checking imalink-core health at: {}", health_url);
    
    match client.get(&health_url).send().await {
        Ok(response) => {
            let status = response.status();
            println!("Health check response status: {}", status);
            
            if status.is_success() {
                match response.text().await {
                    Ok(body) => {
                        println!("Health check response body: {}", body);
                        Ok(format!("✓ imalink-core is running ({})", body))
                    }
                    Err(e) => Err(format!("Failed to read response: {}", e))
                }
            } else {
                Err(format!("Health check failed with status: {}", status))
            }
        }
        Err(e) => {
            eprintln!("Health check request failed: {}", e);
            Err(format!("Cannot connect to imalink-core at {}: {}", core_api_url, e))
        }
    }
}

#[tauri::command]
async fn open_web_gallery(app: tauri::AppHandle, token: Option<String>) -> Result<(), String> {
    let gallery_url = if let Some(auth_token) = token {
        // Pass token as URL fragment (client-side only, not sent to server)
        format!("https://imalink.trollfjell.com/#token={}", auth_token)
    } else {
        "https://imalink.trollfjell.com".to_string()
    };

    WebviewWindowBuilder::new(
        &app,
        "gallery",
        WebviewUrl::External(gallery_url.parse().map_err(|e| format!("Invalid URL: {}", e))?)
    )
    .title("Imalink Gallery")
    .inner_size(1200.0, 800.0)
    .build()
    .map_err(|e| format!("Failed to create gallery window: {}", e))?;

    Ok(())
}
