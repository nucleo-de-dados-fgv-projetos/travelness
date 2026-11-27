@echo off
chcp 65001 >nul
REM Comita as alteracoes desta pasta e envia para o GitHub.
cd /d "%~dp0"

if not exist .git (
  echo Esta pasta nao e um repositorio git. Rode antes: subir-no-github.bat
  pause & exit /b 1
)

echo Alteracoes a enviar:
git status --short
echo.

git add -A || goto :erro
git diff --cached --quiet && (echo Nada novo para comitar. & goto :push)
git commit -F .git-commit-msg.txt || goto :erro

:push
echo Enviando para github.com/nucleo-de-dados-fgv-projetos/travelness ...
git push || goto :erro

echo.
echo ================================================================
echo  Pronto. O GitHub Pages reconstroi sozinho em 1-2 minutos.
echo  Depois disso, recarregue o app no celular:
echo    https://nucleo-de-dados-fgv-projetos.github.io/travelness/
echo  (como e um app offline, pode ser preciso fechar e abrir de novo
echo   para o service worker pegar a versao nova)
echo ================================================================
pause & exit /b 0

:erro
echo.
echo Algo falhou. Veja a mensagem acima.
echo Se foi autenticacao, rode uma vez: gh auth login
pause & exit /b 1
