<#
Ranking de fornecedores (aba "Fornecedores"): agrega compras_produto.json (relatorio oficial
"Compra por Produto", ja sincronizado do SharePoint pelo Power Automate - nao busca nada novo)
em data/dados-fornecedores.json (dado financeiro, fora de public/, mesma regra de
data/dados-valores-insumos.json). O proprio build_fornecedores.py ja copia o resultado
agregado pro SharePoint no final - o CI do GitHub Pages busca so essa copia pequena, nunca o
arquivo bruto de ~87 MB. Pedido do usuario em 26/08/2026.
#>

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$sheetInspect = Join-Path $projectRoot "work\sheet-inspect"
$pythonExe = "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe"
$logDir = Join-Path $PSScriptRoot "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logPath = Join-Path $logDir ("atualizacao-fornecedores-{0}.log" -f (Get-Date -Format "yyyy-MM-dd_HHmmss"))

function Write-Log {
    param([string]$Message)
    $line = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $Message
    Write-Host $line
    Add-Content -LiteralPath $logPath -Value $line
}

function Invoke-Step {
    param(
        [string]$Name,
        [scriptblock]$Action
    )
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

Write-Log "=== Atualizacao de Fornecedores iniciada ==="

Invoke-Step "Gerar data/dados-fornecedores.json (materia-prima + produto acabado) e copiar pro SharePoint" {
    Push-Location $sheetInspect
    try {
        $result = & $pythonExe "build_fornecedores.py" 2>&1
        if ($LASTEXITCODE -ne 0) { throw "build_fornecedores.py saiu com codigo $LASTEXITCODE`: $result" }
        Write-Log ($result -join " ")
    }
    finally { Pop-Location }
}

Write-Log "=== Atualizacao de Fornecedores concluida com sucesso ==="
Write-Log "Nota: data/dados-fornecedores.json e financeiro - nunca vai pro commit (skip-worktree), so o CI busca a copia no SharePoint."
