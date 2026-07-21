$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeRoot = Join-Path $projectRoot '.runtime'
$pythonRoot = Join-Path $runtimeRoot 'python'
$pythonExe = Join-Path $pythonRoot 'python.exe'
$installer = Join-Path $env:TEMP 'python-3.11.9-amd64.exe'

New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
if (-not (Test-Path $pythonExe)) {
  Write-Host 'Downloading private Python 3.11 runtime...'
  Invoke-WebRequest -Uri 'https://www.python.org/ftp/python/3.11.9/python-3.11.9-amd64.exe' -OutFile $installer
  $process = Start-Process -FilePath $installer -ArgumentList @('/quiet', 'InstallAllUsers=0', 'Include_launcher=0', 'Include_test=0', 'PrependPath=0', "TargetDir=$pythonRoot") -Wait -PassThru
  if ($process.ExitCode -ne 0) { throw "Python installer failed with exit code $($process.ExitCode)" }
}

Write-Host 'Installing faster-whisper service dependencies...'
& $pythonExe -m pip install --disable-pip-version-check --upgrade pip
& $pythonExe -m pip install --disable-pip-version-check -r (Join-Path $projectRoot 'whisper-service\requirements.txt')
Write-Host 'Whisper setup complete. Run: npm run dev:local'
