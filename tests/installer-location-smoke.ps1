$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path "$PSScriptRoot/..").Path
$guid = [Guid]::NewGuid().ToString()
$relative = ".tools/installer-location-$guid"
$root = (New-Item -ItemType Directory -Path (Join-Path $repo $relative) -Force).FullName
$key = "HKCU:\Software\$guid"
$uninstall = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$guid"

function Invoke-TestInstaller($target, $expected) {
    # /D must be last. NSIS reads the full remainder as the target.
    $p = Start-Process -FilePath $installer -ArgumentList "/S /currentuser /D=$target" -WindowStyle Hidden -Wait -PassThru
    if ($p.ExitCode -ne $expected) { throw "Expected installer exit $expected, got $($p.ExitCode) for $target" }
}

Push-Location $repo
try {
    $overrides = @("--config.directories.output=$relative", "--config.nsis.guid=$guid", "--config.appId=com.lizitcxyz.nekomimi.location-test.$guid",
        '--config.nsis.artifactName=chieri-directory-test.exe', '--config.nsis.createDesktopShortcut=false',
        '--config.nsis.createStartMenuShortcut=false', '--config.nsis.runAfterFinish=false')
    npm run dist:lite -- @overrides
    if ($LASTEXITCODE -ne 0) { throw 'Cannot build disposable installer' }
    $installer = Join-Path $root 'chieri-directory-test.exe'
    $unrelated = (New-Item -ItemType Directory (Join-Path $root 'Unrelated files')).FullName
    Set-Content -LiteralPath (Join-Path $unrelated 'keep.txt') 'unrelated'
    Invoke-TestInstaller $unrelated 2
    if ((Get-Content -LiteralPath (Join-Path $unrelated 'keep.txt')) -ne 'unrelated') { throw 'Unrelated file changed' }

    $existing = (New-Item -ItemType Directory (Join-Path $root 'Original custom folder')).FullName
    $resources = (New-Item -ItemType Directory (Join-Path $existing 'resources')).FullName
    $exeName = '千绘莉.exe'
    Set-Content -LiteralPath (Join-Path $existing $exeName) 'old executable fixture'
    Set-Content -LiteralPath (Join-Path $existing 'resources.pak') 'old resource fixture'
    Set-Content -LiteralPath (Join-Path $resources 'app.asar') 'old archive fixture'
    Set-Content -LiteralPath (Join-Path $existing 'keep.txt') 'keep on overlay'
    Set-Content -LiteralPath (Join-Path $root 'fixture-user-data.txt') 'unchanged outside installation'
    if (Test-Path -LiteralPath $key) { throw 'Disposable installer already registered' }

    Invoke-TestInstaller $existing 0
    if ((Get-Item -LiteralPath (Join-Path $existing $exeName)).Length -lt 100000) { throw 'Program was not replaced' }
    if ((Get-ItemProperty -LiteralPath $key).InstallLocation -ne $existing) { throw 'Custom path was not registered' }
    if ((Get-Content -LiteralPath (Join-Path $existing 'keep.txt')) -ne 'keep on overlay') { throw 'Overlay deleted an extra file' }
    Invoke-TestInstaller ($existing + '\') 0
    if ((Get-ItemProperty -LiteralPath $key).InstallLocation -ne $existing) { throw 'Registered path changed' }
    if ((Get-Content -LiteralPath (Join-Path $root 'fixture-user-data.txt')) -ne 'unchanged outside installation') { throw 'External data changed' }
    Write-Output 'Disposable NSIS passed unrelated-folder rejection, unregistered in-place overlay, and registered reinstall.'
} finally {
    foreach ($temporaryKey in $key, $uninstall) {
        if (Test-Path -LiteralPath $temporaryKey) { Remove-Item -LiteralPath $temporaryKey }
    }
    Pop-Location
}
