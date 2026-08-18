@echo off
setlocal
cd /d "%~dp0newsfeed"
title 뉴보대 카드뉴스 메이커 - 폰(갤럭시)에서 작업

rem 동봉된 파이썬이 있으면 그것을, 없으면 PC에 설치된 파이썬을 쓴다
set "PY=python"
if exist "python\python.exe" set "PY=python\python.exe"

echo.
echo   ==========================================
echo      뉴보대 카드뉴스 메이커 - 폰에서 작업
echo   ==========================================
echo.
echo   잠시 뒤 "폰 :" 으로 나오는 주소를
echo   갤럭시 브라우저 주소창에 그대로 치세요.
echo.
echo   - 같은 와이파이면 192.168 로 시작하는 주소
echo   - 밖(LTE/5G)이면 폰에 Tailscale 앱을 켠 뒤 100 으로 시작하는 주소
echo   - 노트북 없이 쓰려면(폰에 아무 앱 필요 없음): 바탕화면의
echo     「뉴보대 공개 주소 (폰 어디서나)」 바로가기 주소를 폰에 보내 여세요
echo.
echo   [ 이 검은 창을 닫으면 폰 접속도 끝납니다 ]
echo.

"%PY%" app.py --host 0.0.0.0 --no-browser
if errorlevel 1 (
  echo.
  echo   실행에 실패했습니다.
  echo   이 폴더 안에 python 폴더가 없다면 PC에 Python 3.9 이상이 필요합니다.
  pause
)
