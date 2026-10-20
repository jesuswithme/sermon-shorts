@echo off
chcp 65001 >nul
cd /d "%~dp0"
set PYTHONHOME=
set VIRTUAL_ENV=
set PIP_PREFIX=
set PYTHONNOUSERSITE=
if not exist ".venv\Scripts\python.exe" (
  echo 먼저 setup.cmd 를 실행해 설치해 주세요.
  pause
  exit /b 1
)
echo 설교 쇼츠 메이커를 켜는 중... 이 창을 닫으면 프로그램이 꺼집니다.
".venv\Scripts\python.exe" server.py
pause