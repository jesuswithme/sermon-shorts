# 설교 쇼츠 메이커 설치 스크립트 (Windows)
# 실행: setup.cmd 더블클릭  또는  powershell -ExecutionPolicy Bypass -File setup.ps1
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
'PYTHONHOME','VIRTUAL_ENV','PIP_PREFIX','PYTHONNOUSERSITE' | ForEach-Object { Remove-Item "Env:$_" -ErrorAction SilentlyContinue }

function Step($m) { Write-Host "`n== $m" -ForegroundColor Cyan }

function Test-Py($cmd, $args0) {
    try {
        $v = & $cmd @args0 -c "import sys;print('%d.%d'%sys.version_info[:2])" 2>$null
        if ($LASTEXITCODE -eq 0 -and $v -match '^3\.(1[0-3])$') { return $true }
    } catch {}
    return $false
}

Step "1/5 Python 확인"
$py = $null; $pyArgs = @()
foreach ($c in @(@('py', @('-3.13')), @('py', @('-3.12')), @('py', @('-3.11')), @('python', @()))) {
    if (Test-Py $c[0] $c[1]) { $py = $c[0]; $pyArgs = $c[1]; break }
}
if (-not $py) {
    Write-Host "Python 3.10~3.13 이 없어 설치합니다 (winget)..."
    winget install --id Python.Python.3.12 -e --accept-source-agreements --accept-package-agreements
    $cand = Join-Path $env:LOCALAPPDATA 'Programs\Python\Python312\python.exe'
    if (Test-Path $cand) { $py = $cand } else { throw "Python 설치 후 이 창을 닫고 setup.cmd 를 다시 실행해 주세요." }
}
Write-Host "사용할 Python: $py $pyArgs"

Step "2/5 ffmpeg 확인"
$hasFf = (Get-Command ffmpeg -ErrorAction SilentlyContinue) -or (Test-Path 'C:\ffmpeg') -or
         (Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages') -Filter '*FFmpeg*' -ErrorAction SilentlyContinue)
if (-not $hasFf) {
    Write-Host "ffmpeg 가 없어 설치합니다 (winget)..."
    winget install --id Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements
} else { Write-Host "ffmpeg 있음" }

Step "3/5 프로그램 패키지 설치 (몇 분 걸릴 수 있어요)"
if (-not (Test-Path '.venv\Scripts\python.exe')) { & $py @pyArgs -m venv .venv }
& .\.venv\Scripts\python.exe -m pip install --upgrade pip -q
& .\.venv\Scripts\python.exe -m pip install -r requirements.txt -q
if ($LASTEXITCODE -ne 0) { throw "패키지 설치 실패" }

Step "4/5 받아쓰기 모델 내려받기 (처음 1회, 약 1.6GB)"
& .\.venv\Scripts\python.exe -c "from faster_whisper import WhisperModel; WhisperModel('large-v3-turbo', device='cpu', compute_type='int8'); print('모델 준비 완료')"

Step "5/5 바탕화면 바로가기 만들기"
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) '설교 쇼츠 메이커.lnk'))
$lnk.TargetPath = (Join-Path $PSScriptRoot 'start.cmd')
$lnk.WorkingDirectory = $PSScriptRoot
$lnk.Save()

Write-Host "`n설치 완료! 바탕화면의 '설교 쇼츠 메이커'를 더블클릭하세요." -ForegroundColor Green
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
    Write-Host "(선택) Claude Code 를 설치하면 AI 추천 구간을 쓸 수 있어요. 없어도 자동 규칙으로 추천합니다."
}