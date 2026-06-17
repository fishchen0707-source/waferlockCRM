@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo  WAFERLOCK 本地伺服器啟動中...
echo  請勿關閉此視窗（關閉視窗 = 關閉伺服器）
echo ============================================
echo.
echo  在瀏覽器同一視窗開兩個分頁：
echo    客服 / CRM 端 ：http://localhost:8765/waferlock_crm.html
echo    客戶 / LINE 端 ：http://localhost:8765/waferlock_LINE.html
echo.
start "" "http://localhost:8765/waferlock_crm.html"
start "" "http://localhost:8765/waferlock_LINE.html"
python -m http.server 8765
pause
