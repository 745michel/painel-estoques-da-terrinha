<#
Atualiza Terceiros, Embalagens/MP, Consumo de insumos e o plano MRP de Terceiros sem
intervenção manual. Ordem e regra de falha vêm de REGRAS_PAINEL_ESTOQUES.md: qualquer etapa
que falhar interrompe a rotina imediatamente, sem deixar dados antigos misturados com novos.

Fora de escopo aqui, de propósito:
- Escadinha geral de compras - upload manual mensal, não precisa rodar 3x/dia como o resto;
  tem tarefa agendada própria (AtualizarEscadinha, uma vez por dia às 08:00) chamando
  atualizar_escadinha.ps1. Ver CLAUDE.md, 18/08/2026.
- Valor dos insumos (fica para a extração via Power Automate/DAX).
- Publicação do painel (segue manual).
#>

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$sheetInspect = Join-Path $projectRoot "work\sheet-inspect"
$pythonExe = "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe"
$logDir = Join-Path $PSScriptRoot "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logPath = Join-Path $logDir ("atualizacao-{0}.log" -f (Get-Date -Format "yyyy-MM-dd_HHmmss"))

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
        Write-Log "ROTINA INTERROMPIDA. Dados anteriores preservados; nada parcial foi publicado."
        exit 1
    }
}

if (-not (Test-Path -LiteralPath $pythonExe)) {
    Write-Log "FALHA: Python nao encontrado em $pythonExe"
    exit 1
}

Write-Log "=== Atualizacao diaria iniciada ==="

# A automacao COM do Excel nao convive bem com nenhuma outra instancia do Excel na maquina
# (ver CLAUDE.md, 05/08/2026). Antes de comecar: mata sobras invisiveis de execucoes
# anteriores (sem titulo de janela = instancia automatizada, nunca uma janela real do
# usuario) e aborta rapido, com mensagem clara, se houver uma janela REAL aberta - em vez de
# descobrir isso so depois de alguns minutos travado em Workbooks.Open.
$excelProcs = @(Get-Process -Name EXCEL -ErrorAction SilentlyContinue)
if ($excelProcs.Count -gt 0) {
    $realWindows = @($excelProcs | Where-Object { $_.MainWindowTitle })
    if ($realWindows.Count -gt 0) {
        $titles = ($realWindows | ForEach-Object { $_.MainWindowTitle }) -join ", "
        Write-Log "FALHA: ha janela(s) real(is) do Excel aberta(s) ($titles). Feche antes de rodar a atualizacao."
        exit 1
    }
    foreach ($proc in $excelProcs) {
        Write-Log "Limpando instancia invisivel de Excel sobrada (PID $($proc.Id)) antes de iniciar"
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 2
}

Invoke-Step "Atualizar planilha de Terceiros (Excel COM)" {
    # -SkipMovimentoEstoque: essa conexao especifica so alimenta a coluna F ("inventory") de
    # PROD. ACAB, que dados-estoque.json nao usa (verificado 05/08/2026), e tem historico de
    # estourar o timeout de 12 min nesse arquivo. Ver nota em refresh_workbooks.ps1 e CLAUDE.md.
    $result = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $sheetInspect "refresh_workbooks.ps1") -Alvo Terceiros -SkipMovimentoEstoque 2>&1
    if ($LASTEXITCODE -ne 0) { throw "refresh_workbooks.ps1 (Terceiros) saiu com codigo $LASTEXITCODE`: $($result -join ' | ')" }
    Write-Log ($result -join " ")
}

Invoke-Step "Atualizar planilha de Embalagens/MP (Excel COM)" {
    $result = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $sheetInspect "refresh_workbooks.ps1") -Alvo Embalagens 2>&1
    if ($LASTEXITCODE -ne 0) { throw "refresh_workbooks.ps1 (Embalagens) saiu com codigo $LASTEXITCODE`: $($result -join ' | ')" }
    Write-Log ($result -join " ")
}

Invoke-Step "Atualizar planilha MRP Terceiros (Excel COM)" {
    # Plano de compra/producao por terceiro (Carteira, Plano x Real do mes, cortes), cruzado
    # por SKU com Estoque de terceiros. Ver CLAUDE.md, 13/08/2026.
    $result = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $sheetInspect "refresh_workbooks.ps1") -Alvo MrpTerceiros 2>&1
    if ($LASTEXITCODE -ne 0) { throw "refresh_workbooks.ps1 (MrpTerceiros) saiu com codigo $LASTEXITCODE`: $($result -join ' | ')" }
    Write-Log ($result -join " ")
}

Invoke-Step "Gerar dados-mrp-terceiros.json" {
    Push-Location $sheetInspect
    try {
        $result = & $pythonExe "extract_mrp_terceiros.py" 2>&1
        if ($LASTEXITCODE -ne 0) { throw "extract_mrp_terceiros.py saiu com codigo $LASTEXITCODE`: $result" }
        Write-Log ($result -join " ")
    }
    finally { Pop-Location }
}

Invoke-Step "Gerar dados-estoque.json e dados-insumos.json (leitura das planilhas)" {
    Push-Location $sheetInspect
    try {
        $result = & $pythonExe "extract_products.py" 2>&1
        if ($LASTEXITCODE -ne 0) { throw "extract_products.py saiu com codigo $LASTEXITCODE`: $result" }
        Write-Log ($result -join " ")
    }
    finally { Pop-Location }
}

Invoke-Step "Padronizar Estoque/Saldo/Cobertura de Terceiros com o BI (produtos_estoque.json)" {
    # Fonte unica com a aba Estoque x Pedidos - pedido do usuario em 20/08/2026, as duas bases
    # mostravam numeros diferentes pro mesmo produto (planilha Terceiro Estoque X Pedido.xlsm
    # vs relatorio Power BI). Ver apply_bi_terceiros.py.
    Push-Location $sheetInspect
    try {
        $result = & $pythonExe "apply_bi_terceiros.py" 2>&1
        if ($LASTEXITCODE -ne 0) { throw "apply_bi_terceiros.py saiu com codigo $LASTEXITCODE`: $result" }
        Write-Log ($result -join " ")
    }
    finally { Pop-Location }
}

Invoke-Step "Extrair historico de consumo (ODBC direto, sem Power BI)" {
    $result = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $sheetInspect "extract_consumption_history.ps1") 2>&1
    if ($LASTEXITCODE -ne 0) { throw "extract_consumption_history.ps1 saiu com codigo $LASTEXITCODE`: $($result -join ' | ')" }
    Write-Log ($result -join " ")
}

Invoke-Step "Gerar dados-consumo-insumos.json" {
    Push-Location $sheetInspect
    try {
        $result = & $pythonExe "build_consumption_history.py" 2>&1
        if ($LASTEXITCODE -ne 0) { throw "build_consumption_history.py saiu com codigo $LASTEXITCODE`: $result" }
        Write-Log ($result -join " ")
    }
    finally { Pop-Location }
}

Invoke-Step "Publicar copia dos JSONs locais no SharePoint (DT-BI)" {
    $destino = "C:\Users\Daterrinha63\daterrinhaalimentos.com.br\DT - BI DADOS - PCP\extracao_dados_planejamento_estoque"
    if (-not (Test-Path -LiteralPath $destino)) { throw "Pasta sincronizada do SharePoint nao encontrada: $destino" }
    $arquivos = @(
        (Join-Path $projectRoot "public\dados-estoque.json"),
        (Join-Path $projectRoot "public\dados-insumos.json"),
        (Join-Path $projectRoot "public\dados-consumo-insumos.json"),
        (Join-Path $projectRoot "public\dados-mrp-terceiros.json")
    )
    foreach ($arquivo in $arquivos) {
        Copy-Item -LiteralPath $arquivo -Destination $destino -Force
        Write-Log "Copiado: $(Split-Path -Leaf $arquivo)"
    }
}

Write-Log "=== Atualizacao diaria concluida com sucesso ==="
Write-Log "Pendente (fora deste programa): publicacao do painel."
