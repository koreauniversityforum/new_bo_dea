@echo off
chcp 949 >nul
cd /d "%~dp0"
set PYTHONUTF8=1
echo.
echo  [메타 연결] 1단계 - 앱 ID와 시크릿 넣기
echo  developers.facebook.com - 내 앱 - 설정 - 기본 설정 에서 복사해 붙여넣으세요.
echo  (붙여넣기는 마우스 오른쪽 클릭)
echo.
python 메타_연결.py 앱
echo.
echo  끝났습니다. 이 창을 닫고 Claude 에게 알려 주세요.
pause
