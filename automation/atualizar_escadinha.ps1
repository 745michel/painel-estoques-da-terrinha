<#
Escadinha geral de compras: upload manual mensal do usuario (escadinha_compras.xlsx e a pasta
HISTORICO ESCADINHA), nao muda todo dia como Terceiros/Embalagens - por isso tem tarefa
agendada propria, uma vez por dia as 08:00, em vez de rodar 3x/dia junto com
atualizar_dados.ps1. Pedido do usuario em 18/08/2026.
#>

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$sheetInspect = Join-Path $projectRoot "work\sheet-inspect"
$pythonExe = "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe"
$logDir = Join-Path $PSScriptRoot "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logPath = Join-Path $logDir ("atualizacao-escadinha-{0}.log" -f (Get-Date -Format "yyyy-MM-dd_HHmmss"))

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

Write-Log "=== Atualizacao da Escadinha iniciada ==="

# So le arquivos com openpyxl (sem Excel COM), mas ainda evita ler um arquivo que o usuario
# esteja editando nesse momento - mesma logica de seguranca do atualizar_dados.ps1.
$excelProcs = @(Get-Process -Name EXCEL -ErrorAction SilentlyContinue)
if ($excelProcs.Count -gt 0) {
    $realWindows = @($excelProcs | Where-Object { $_.MainWindowTitle })
    if ($realWindows.Count -gt 0) {
        $titles = ($realWindows | ForEach-Object { $_.MainWindowTitle }) -join ", "
        Write-Log "FALHA: ha janela(s) real(is) do Excel aberta(s) ($titles). Feche antes de rodar a atualizacao."
        exit 1
    }
}

Invoke-Step "Gerar dados-escadinha.json (plano atual + historico + realizado)" {
    Push-Location $sheetInspect
    try {
        $result = & $pythonExe "extract_escadinha.py" 2>&1
        if ($LASTEXITCODE -ne 0) { throw "extract_escadinha.py saiu com codigo $LASTEXITCODE`: $result" }
        Write-Log ($result -join " ")
    }
    finally { Pop-Location }
}

Invoke-Step "Publicar copia do JSON local no SharePoint (DT-BI)" {
    $destino = "C:\Users\Daterrinha63\daterrinhaalimentos.com.br\DT - BI DADOS - PCP\extracao_dados_planejamento_estoque"
    if (-not (Test-Path -LiteralPath $destino)) { throw "Pasta sincronizada do SharePoint nao encontrada: $destino" }
    Copy-Item -LiteralPath (Join-Path $projectRoot "public\dados-escadinha.json") -Destination $destino -Force
    Write-Log "Copiado: dados-escadinha.json"
}

Write-Log "=== Atualizacao da Escadinha concluida com sucesso ==="
Write-Log "Pendente (fora deste programa): publicacao do painel."
