# Builds code-navigator-<version>.vsix without node/vsce (a .vsix is a zip with a manifest).
# Usage:  powershell -ExecutionPolicy Bypass -File scripts\pack.ps1 [-Install]
param([switch]$Install)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem

$root = Split-Path -Parent $PSScriptRoot
$pkg = Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
$out = Join-Path $root "$($pkg.name)-$($pkg.version).vsix"

$manifest = @"
<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="$($pkg.name)" Version="$($pkg.version)" Publisher="$($pkg.publisher)" />
    <DisplayName>$($pkg.displayName)</DisplayName>
    <Description xml:space="preserve">$([System.Security.SecurityElement]::Escape($pkg.description))</Description>
    <Categories>Programming Languages,Other</Categories>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="$($pkg.engines.vscode)" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="workspace" />
    </Properties>
  </Metadata>
  <Installation><InstallationTarget Id="Microsoft.VisualStudio.Code" /></Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Icons.Default" Path="extension/images/icon.png" Addressable="true" />
  </Assets>
</PackageManifest>
"@
$contentTypes = @"
<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension=".json" ContentType="application/json" /><Default Extension=".js" ContentType="application/javascript" /><Default Extension=".md" ContentType="text/markdown" /><Default Extension=".png" ContentType="image/png" /><Default Extension=".vsixmanifest" ContentType="text/xml" /></Types>
"@

if (Test-Path $out) { Remove-Item $out -Force -Confirm:$false }
$zip = [System.IO.Compression.ZipFile]::Open($out, 'Create')
try {
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    foreach ($e in @(@('extension.vsixmanifest', $manifest), @('[Content_Types].xml', $contentTypes))) {
        $w = New-Object System.IO.StreamWriter($zip.CreateEntry($e[0]).Open(), $utf8)
        $w.Write($e[1]); $w.Dispose()
    }
    $files = @('package.json', 'extension.js', 'README.md', 'LICENSE', 'images/icon.png') +
        (Get-ChildItem (Join-Path $root 'src') -Recurse -File | ForEach-Object { $_.FullName.Substring($root.Length + 1) })
    foreach ($f in $files) {
        $entry = 'extension/' + ($f -replace '\\', '/')   # forward slashes required by VS Code
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, (Join-Path $root $f), $entry) | Out-Null
    }
} finally { $zip.Dispose() }
Write-Host "Created $out"

if ($Install) { & code --install-extension $out --force }
