<#
Roda as 3 rotinas de dados (Terceiros/Embalagens/Consumo + BI, Escadinha, Estoque x Pedidos) e,
se pelo menos uma gerar mudanca real, comita e publica sozinho (git add + commit + push).
Substitui as 3 tarefas agendadas separadas (AtualizarPainelEstoques, AtualizarEscadinha,
AtualizarPedidosVenda), que rodavam no mesmo horario e podiam disputar o git ao tentar publicar
cada uma por conta propria. Criado a pedido do usuario em 20/08/2026: "quero usar voce so pra
criar novos relatorios e melhorias, os dados tem que vir automatico" - a partir de agora
ninguem precisa pedir pra atualizar ou publicar o painel, so pra mudar/criar alguma coisa nova.

Cada rotina roda independente (uma falhar nao trava as outras) - se uma pipeline falhar, o
JSON dela fica no ultimo valor bom (os scripts individuais ja sao atomicos e param no primeiro
erro), e so os arquivos das pipelines que deram certo entram no commit.
#>

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $PSScriptRoot "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logPath = Join-Path $logDir ("publicar-tudo-{0}.log" -f (Get-Date -Format "yyyy-MM-dd_HHmmss"))

function Write-Log {
    param([string]$Message)
    $line = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $Message
    Write-Host $line
    Add-Content -LiteralPath $logPath -Value $line
}

function Invoke-Pipeline {
    param([string]$Nome, [string]$Script)
    Write-Log "INICIO: $Nome"
    $start = Get-Date
    try {
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Script
        if ($LASTEXITCODE -ne 0) { throw "saiu com codigo $LASTEXITCODE" }
        $elapsed = [math]::Round(((Get-Date) - $start).TotalSeconds, 1)
        Write-Log "OK: $Nome (${elapsed}s)"
        return $true
    }
    catch {
        $elapsed = [math]::Round(((Get-Date) - $start).TotalSeconds, 1)
        Write-Log "FALHA: $Nome (${elapsed}s) - $($_.Exception.Message) - dados anteriores preservados, seguindo pras outras pipelines."
        return $false
    }
}

Write-Log "=== Atualizacao + publicacao automatica iniciada ==="

$resultados = [ordered]@{
    "Terceiros/Embalagens/Consumo/BI" = Invoke-Pipeline "Terceiros/Embalagens/Consumo/BI" (Join-Path $PSScriptRoot "atualizar_dados.ps1")
    "Escadinha"                        = Invoke-Pipeline "Escadinha" (Join-Path $PSScriptRoot "atualizar_escadinha.ps1")
    "Estoque x Pedidos"                = Invoke-Pipeline "Estoque x Pedidos" (Join-Path $PSScriptRoot "atualizar_pedidos_venda.ps1")
}

$falhas = $resultados.GetEnumerator() | Where-Object { -not $_.Value } | ForEach-Object { $_.Key }
if ($falhas) {
    Write-Log "Pipelines com falha (nao publicadas nesta rodada): $($falhas -join ', ')"
}

Push-Location $projectRoot
try {
    $status = git status --porcelain -- public/*.json 2>&1
    if (-not $status) {
        Write-Log "Nada mudou nos dados - nada pra publicar."
    }
    else {
        Write-Log "Mudancas detectadas, publicando:`n$status"
        # Sem "2>&1" nas chamadas nativas de proposito: no PowerShell 5.1 isso envolve cada
        # linha de stderr num ErrorRecord e derruba $LASTEXITCODE mesmo quando o comando deu
        # certo (git manda progresso normal pro stderr) - causou um falso "FALHA ao publicar"
        # com push que tinha ido certo, descoberto em 20/08/2026.
        git add -- public/*.json
        if ($LASTEXITCODE -ne 0) { throw "git add saiu com codigo $LASTEXITCODE" }
        $dataHora = Get-Date -Format "dd/MM HH:mm"
        $mensagem = "Atualizacao automatica de dados ($dataHora)"
        git commit -m $mensagem
        if ($LASTEXITCODE -ne 0) { throw "git commit saiu com codigo $LASTEXITCODE" }
        git push origin main
        if ($LASTEXITCODE -ne 0) { throw "git push saiu com codigo $LASTEXITCODE" }
        Write-Log "Publicado com sucesso."
    }
}
catch {
    Write-Log "FALHA ao publicar: $($_.Exception.Message)"
    exit 1
}
finally {
    Pop-Location
}

Write-Log "=== Atualizacao + publicacao automatica concluida ==="
