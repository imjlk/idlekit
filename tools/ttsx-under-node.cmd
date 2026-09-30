@echo off
set "root=%~dp0.."
node "%root%\node_modules\ttsc\lib\launcher\ttsx.js" %*
