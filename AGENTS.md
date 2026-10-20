# AI 에이전트용 설치 안내

사용자가 "이 프로그램을 설치해줘"라고 하면 Windows 에서 다음을 실행하세요.

1. 저장소를 받습니다: `git clone https://github.com/jesuswithme/sermon-shorts.git "$HOME\sermon-shorts"` (git 이 없으면 ZIP 다운로드 후 압축 해제)
2. 설치: `powershell -NoProfile -ExecutionPolicy Bypass -File "$HOME\sermon-shorts\setup.ps1"`
   - Python 3.10~3.13, ffmpeg 가 없으면 winget 으로 설치합니다. winget 으로 Python 을 새로 설치했다면 새 셸에서 setup.ps1 을 한 번 더 실행하세요.
   - PYTHONHOME / VIRTUAL_ENV / PIP_PREFIX 환경변수가 설정된 셸이면 스크립트가 지우고 진행합니다.
3. 실행: 바탕화면의 '설교 쇼츠 메이커' 바로가기 또는 `start.cmd`. 브라우저에서 http://127.0.0.1:8765 이 열립니다.

구조: `server.py`(표준 라이브러리 HTTP 서버 + yt-dlp + faster-whisper + ffmpeg/libass 렌더링), `web/`(화면). AI 추천은 PATH 의 `claude` CLI 를 `claude -p` 로 호출하며, 없으면 규칙 기반 추천으로 대체됩니다.