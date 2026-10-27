<#
6a etapa da automacao (Fase 5 da migracao Railway, ver CLAUDE.md e
C:\Users\Daterrinha63\.claude\plans\synchronous-wobbling-fern.md) - sincroniza as 13 tabelas do
Postgres (Railway, projeto Estoque-PCP, servico Postgres) com os JSON locais que as outras
pipelines ja geraram (nenhuma extracao nova, so le public/*.json e data/*.json e grava no
banco via work/sheet-inspect/sync_postgres.mts).

Abre um tunel SSH local (porta 55432) so pelo tempo da sincronizacao e sempre fecha no final
(finally) - nunca deixa o tunel aberto, nunca expoe o Postgres publicamente. Precisa do Railway
CLI logado nesta maquina e da chave SSH ja registrada (ver historico da migracao, chave
~/.ssh/id_ed25519_railway) - roda sem nenhuma interacao manual.

Falha isolada por dataset (dentro de sync_postgres.mts, tabela sync_runs guarda cada tentativa)
- esse script so falha no geral se o tunel nao abrir ou se o sync inteiro quebrar.
#>

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $PSScriptRoot "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

Push-Location $projectRoot
$tunnelProcess = $null
try {
    $carimbo = Get-Date -Format "yyyy-MM-dd_HHmmss"
    $tunnelLog = Join-Path $logDir ("postgres-tunnel-{0}.log" -f $carimbo)
    $tunnelErrLog = Join-Path $logDir ("postgres-tunnel-{0}.err.log" -f $carimbo)
    # "railway" e um shim .cmd (node) - Start-Process com redirecionamento de stream exige um
    # executavel de verdade (CreateProcess), por isso passa por cmd.exe /c.
    $tunnelProcess = Start-Process -FilePath "cmd.exe" `
        -ArgumentList @("/c", "railway connect Postgres --tunnel-only -P 55432") `
        -RedirectStandardOutput $tunnelLog -RedirectStandardError $tunnelErrLog `
        -WindowStyle Hidden -PassThru

    $portaAberta = $false
    for ($i = 0; $i -lt 20; $i++) {
        Start-Sleep -Seconds 1
        $teste = Test-NetConnection -ComputerName localhost -Port 55432 -WarningAction SilentlyContinue -InformationLevel Quiet
        if ($teste) { $portaAberta = $true; break }
    }
    if (-not $portaAberta) {
        throw "tunel SSH nao abriu a porta 55432 em 20s (ver log: $tunnelLog)"
    }

    & railway run --service Postgres -- node --env-file=.env.local node_modules/tsx/dist/cli.mjs work/sheet-inspect/sync_postgres.mts
    if ($LASTEXITCODE -ne 0) {
        throw "sync_postgres.mts saiu com codigo $LASTEXITCODE (alguns datasets podem ter falhado - ver tabela sync_runs no Postgres)"
    }
}
finally {
    if ($tunnelProcess -and -not $tunnelProcess.HasExited) {
        # /T mata a arvore inteira (cmd.exe -> node -> railway.exe -> ssh.exe) - matar so o
        # cmd.exe (Stop-Process sem /T) deixaria o ssh.exe orfao rodando pra sempre.
        & taskkill /F /T /PID $tunnelProcess.Id 2>&1 | Out-Null
    }
    Pop-Location
}
