<#
Cortes: gera dados-cortes.json cruzando dados_cortes.json (Power Automate, ja sincronizado do
SharePoint - nao busca nada novo) com o motivo preenchido manualmente em motivos_cortes.xlsx
(mesma pasta sincronizada). Publicacao (commit+push) continua manual, igual
atualizar_pedidos_venda.ps1. Criada a pedido do usuario em 05/10/2026.
#>

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$sheetInspect = Join-Path $projectRoot "work\sheet-inspect"
$pythonExe = "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe"
$logDir = Join-Path $PSScriptRoot "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logPath = Join-Path $logDir ("atualizacao-cortes-{0}.log" -f (Get-Date -Format "yyyy-MM-dd_HHmmss"))

function Write-Log {
    param([string]$Message)
    $line = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $Message
    Write-Host $line
    Add-Content -LiteralPath $logPath -Value $line
}

function Invoke-Step {
    param([string]$Name, [scriptblock]$Action)
    Write-Log "INICIO: $Name"
    $start = Get-Date
    try {
        & $Action
        $elapsed = [math]::Round(((Get-Date) - $start).TotalSeconds, 1)
        Write-Log "OK: $Name (${elapsed}s)"
    }
    catch {
        $elapsed = [math]::Round(((Get-Date) - $start).TotalSeconds, 1)
        Write-Log "FALHA: $Name (${elapsed}s) - $($_.Exception.Message)"
        Write-Log "ROTINA INTERROMPIDA."
        exit 1
    }
}

if (-not (Test-Path -LiteralPath $pythonExe)) {
    Write-Log "FALHA: Python nao encontrado em $pythonExe"
    exit 1
}

Write-Log "=== Atualizacao de Cortes iniciada ==="

Invoke-Step "Gerar dados-cortes.json" {
    Push-Location $sheetInspect
    try {
        $result = & $pythonExe "build_cortes.py" 2>&1
        if ($LASTEXITCODE -ne 0) { throw "build_cortes.py saiu com codigo $LASTEXITCODE`: $result" }
        Write-Log ($result -join " ")
    }
    finally { Pop-Location }
}

Write-Log "=== Atualizacao de Cortes concluida com sucesso ==="
Write-Log "Pendente (fora deste programa): publicacao do painel (commit+push)."
