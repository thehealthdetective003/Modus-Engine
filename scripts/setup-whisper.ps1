$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeRoot = Join-Path $projectRoot '.runtime'
$pythonRoot = Join-Path $runtimeRoot 'python'
$pythonExe = Join-Path $pythonRoot 'Scripts\python.exe'
$installedPython = Join-Path $env:LocalAppData 'Programs\Python\Python311\python.exe'
$installer = Join-Path $env:TEMP 'python-3.11.9-amd64.exe'
$installLog = Join-Path $runtimeRoot 'python-install.log'
$tokenFile = Join-Path $runtimeRoot 'whisper-access-token.txt'

New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
if (-not (Test-Path $pythonExe)) {
  if (-not (Test-Path $installedPython)) {
    Write-Host 'Downloading Python 3.11 runtime...'
    Invoke-WebRequest -Uri 'https://www.python.org/ftp/python/3.11.9/python-3.11.9-amd64.exe' -OutFile $installer
    $arguments = "/quiet InstallAllUsers=0 Include_launcher=0 Include_test=0 Include_doc=0 Include_tcltk=0 Include_pip=1 PrependPath=0 /log `"$installLog`""
    $process = Start-Process -FilePath $installer -ArgumentList $arguments -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "Python installer failed with exit code $($process.ExitCode)" }
  }
  if (-not (Test-Path $installedPython)) { throw "Python 3.11 was not found after installation. Review: $installLog" }
  Write-Host 'Creating project-local Python environment...'
  & $installedPython -m venv $pythonRoot
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $pythonExe)) { throw 'Could not create the project-local Python environment.' }
}

Write-Host 'Installing faster-whisper service dependencies...'
& $pythonExe -m pip install --disable-pip-version-check --upgrade pip
& $pythonExe -m pip install --disable-pip-version-check -r (Join-Path $projectRoot 'whisper-service\requirements.txt')
if (-not (Test-Path $tokenFile)) {
  $accessToken = ([guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N'))
  Set-Content -LiteralPath $tokenFile -Value $accessToken -NoNewline
}
Write-Host "Google AI Studio access token: $(Get-Content -LiteralPath $tokenFile)"
Write-Host 'Whisper setup complete. Run: npm run dev:local'
