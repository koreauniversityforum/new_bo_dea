@echo off
setlocal
cd /d "%~dp0newsfeed"
title 뉴보대 카드뉴스 메이커

rem 동봉된 파이썬이 있으면 그것을, 없으면 PC에 설치된 파이썬을 쓴다
set "PY=python"
if exist "python\python.exe" set "PY=python\python.exe"

echo.
echo   ==========================================
echo      뉴보대 카드뉴스 메이커
echo   ==========================================
echo.
echo   전용 창으로 띄웁니다. 잠시만 기다려 주세요.
echo   (주소창도 탭도 없는 우리 창이 뜹니다)
echo.
echo   [ 그 창을 닫으면 프로그램도 함께 끝납니다 ]
echo.

rem --hide-console : 전용 창이 뜨면 이 검은 창을 숨긴다.
rem   창을 못 띄운 PC에서는 숨기지 않고 주소를 보여주며 평소 브라우저로 연다.
"%PY%" app.py --hide-console
if errorlevel 1 goto fail
goto end

:fail
echo.
echo   ------------------------------------------
echo   실행에 실패했습니다.
echo.
echo   이 폴더 안에 python 폴더가 없다면
echo   PC에 Python 3.9 이상이 설치되어 있어야 합니다.
echo   ------------------------------------------
echo.
pause

:end
