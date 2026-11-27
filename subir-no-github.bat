@echo off
chcp 65001 >nul
REM Cria o repositorio nesta pasta e envia para o GitHub.
REM Rode uma vez. Depois disso, use git normalmente.

cd /d "%~dp0"

if exist .git (
  echo Ja existe um repositorio git aqui. Pulando a criacao.
) else (
  git init -b main || goto :erro
  git add -A || goto :erro
  git commit -F .git-commit-msg.txt || goto :erro
  git remote add origin https://github.com/nucleo-de-dados-fgv-projetos/travelness.git || goto :erro
)

echo.
echo Enviando para github.com/nucleo-de-dados-fgv-projetos/travelness ...
git push -u origin main || goto :erro

echo.
echo ================================================================
echo  Pronto. Agora ligue o GitHub Pages:
echo    Settings - Pages - Source: main / docs
echo  O app ficara em https://nucleo-de-dados-fgv-projetos.github.io/travelness/
echo ================================================================
pause
exit /b 0

:erro
echo.
echo Algo falhou. Verifique a mensagem acima.
echo Se foi autenticacao, instale o GitHub CLI e rode: gh auth login
pause
exit /b 1
