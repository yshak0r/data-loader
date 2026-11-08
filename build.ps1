# Ross DC Loader Build Helper
# Handles Windows Application Control / AppLocker restrictions on AppData\Local\Temp

param (
    [switch]$RegenerateBindings = $false,
    [switch]$Dev = $false
)

$ErrorActionPreference = "Stop"

# Ensure Go and Wails are on PATH
if ($env:PATH -notmatch "Go\\bin") {
    $env:PATH += ";C:\Program Files\Go\bin"
}
if ($env:PATH -notmatch "Users.*\\go\\bin") {
    $env:PATH += ";$env:USERPROFILE\go\bin"
}

# Redirect TEMP away from AppData\Local\Temp to bypass AppLocker / WDAC
$customTemp = "D:\temp"
if (!(Test-Path $customTemp)) {
    New-Item -ItemType Directory -Path $customTemp -Force | Out-Null
}
$env:TEMP = $customTemp
$env:TMP = $customTemp

if ($Dev) {
    Write-Host "Starting Wails dev server..." -ForegroundColor Cyan
    wails dev -m -skipbindings
    exit 0
}

Write-Host "Building Ross DC Loader..." -ForegroundColor Cyan

if ($RegenerateBindings) {
    wails build -m -o "dc-loader-wails.exe"
} else {
    wails build -m -skipbindings -o "dc-loader-wails.exe"
}

if (Test-Path "build\bin\dc-loader-wails.exe") {
    Copy-Item "build\bin\dc-loader-wails.exe" "build\bin\Ross DC Loader.exe" -Force
    Write-Host "Build complete: build\bin\Ross DC Loader.exe" -ForegroundColor Green
}

