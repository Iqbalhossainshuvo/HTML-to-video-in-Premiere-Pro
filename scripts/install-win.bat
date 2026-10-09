@echo off
REM Installs the HTML to Video panel for Adobe Premiere Pro on Windows.
setlocal
set "SRC=%~dp0.."
set "DEST=%APPDATA%\Adobe\CEP\extensions\HTMLtoVideo"

echo Installing to: %DEST%
if not exist "%DEST%" mkdir "%DEST%"
robocopy "%SRC%" "%DEST%" /MIR /XD .git scripts tools skill app dist node_modules .github /NFL /NDL /NJH /NJS >nul

REM Allow unsigned extensions (needed for panels installed from source)
for %%v in (10 11 12 13 14) do (
  reg add "HKCU\Software\Adobe\CSXS.%%v" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul
)

echo Done. Restart Premiere Pro or After Effects, then open Window ^> Extensions ^> HTML to Video.
pause
