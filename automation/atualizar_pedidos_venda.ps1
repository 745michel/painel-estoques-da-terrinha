<#
Estoque x Pedidos (produto acabado): roda o lookup de categoria/escopo no Postgres e depois
gera dados-pedidos-venda.json a partir de produtos_estoque.json + dados_cortes.json (ambos
Power Automate, ja sincronizados do SharePoint - essa tarefa nao busca nada nova, so processa
o que ja chegou). Publicacao (commit+push) continua manual, igual atualizar_dados.ps1 e
atualizar_escadinha.ps1. Criada a pedido do usuario em 20/08/2026.
#>

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$sheetInspect = Join-Path $projectRoot "work\sheet-inspect"
$pythonExe = "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe"
$logDir = Join-Path $PSScriptRoot "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logPath = Join-Path $logDir ("atualizacao-pedidos-venda-{0}.log" -f (Get-Date -Format "yyyy-MM-dd_HHmmss"))

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

Write-Log "=== Atualizacao de Estoque x Pedidos iniciada ==="

Invoke-Step "Lookup de categoria/escopo (Postgres)" {
    $result = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $sheetInspect "extract_pedidos_venda_odbc.ps1") 2>&1
    if ($LASTEXITCODE -ne 0) { throw "extract_pedidos_venda_odbc.ps1 saiu com codigo $LASTEXITCODE`: $($result -join ' | ')" }
    Write-Log ($result -join " ")
}

Invoke-Step "Gerar dados-pedidos-venda.json" {
    Push-Location $sheetInspect
    try {
        $result = & $pythonExe "build_pedidos_venda.py" 2>&1
        if ($LASTEXITCODE -ne 0) { throw "build_pedidos_venda.py saiu com codigo $LASTEXITCODE`: $result" }
        Write-Log ($result -join " ")
    }
    finally { Pop-Location }
}

Write-Log "=== Atualizacao de Estoque x Pedidos concluida com sucesso ==="
Write-Log "Pendente (fora deste programa): publicacao do painel (commit+push)."
