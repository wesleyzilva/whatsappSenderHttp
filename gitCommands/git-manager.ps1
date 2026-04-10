#Requires -Version 5.1
<#
.SYNOPSIS
    Gerenciador Git interativo para o repositorio dradaianaferraz_gold.

.DESCRIPTION
    Menu completo:
      1. Comparar local vs remoto (qual esta mais atualizado)
      2. Baixar do remoto (pull)
      3. Subir para o remoto (push)
      4. Listar branches
      5. Trocar de branch
      6. Commitar com mensagem aleatoria
      7. Informacoes do repositorio
      0. Sair

.USAGE
    cd C:\repositorio\dradaianaferraz_gold\gitCommands
    .\git-manager.ps1

    Ou informando outro caminho de repositorio:
    .\git-manager.ps1 -RepoPath "C:\outro\repo"
#>

param(
    [string]$RepoPath = (Split-Path $PSScriptRoot -Parent)
)

Set-StrictMode -Off
$ErrorActionPreference = 'Continue'

# ---------------------------------------------------------------------------
# Mensagens aleatorias de commit
# ---------------------------------------------------------------------------
$COMMIT_MESSAGES = @(
    'chore: ajustes gerais de manutencao',
    'chore: limpeza de codigo e formatacao',
    'chore: pequenas melhorias internas',
    'fix: correcao de comportamento inesperado',
    'fix: ajuste de logica e fluxo',
    'fix: revisao de parametros e valores',
    'feat: melhoria de experiencia do usuario',
    'feat: atualizacao de conteudo da pagina',
    'feat: refinamento visual e funcional',
    'refactor: reorganizacao de estrutura interna',
    'refactor: simplificacao de modulo',
    'style: ajuste de estilos e layout',
    'style: padronizacao de formatacao',
    'docs: atualizacao de documentacao interna',
    'perf: otimizacao de carregamento',
    'build: atualizacao de dependencias',
    'ci: ajuste de configuracao de integracao'
)

# ---------------------------------------------------------------------------
# Funcoes de exibicao
# ---------------------------------------------------------------------------
function Write-Header {
    param([string]$Text)
    $line = '=' * ($Text.Length + 4)
    Write-Host ''
    Write-Host "+$line+" -ForegroundColor Cyan
    Write-Host "|  $Text  |" -ForegroundColor Cyan
    Write-Host "+$line+" -ForegroundColor Cyan
    Write-Host ''
}

function Write-OK   { param([string]$M); Write-Host "  [OK] $M" -ForegroundColor Green  }
function Write-Warn { param([string]$M); Write-Host "  [!!] $M" -ForegroundColor Yellow }
function Write-Err  { param([string]$M); Write-Host "  [XX] $M" -ForegroundColor Red    }
function Write-Info { param([string]$M); Write-Host "  [..] $M" -ForegroundColor Cyan   }
function Write-Bold { param([string]$M); Write-Host "  $M"       -ForegroundColor White  }

# ---------------------------------------------------------------------------
# Validar que estamos em um repositorio Git
# ---------------------------------------------------------------------------
function Assert-Repo {
    if (-not (Test-Path (Join-Path $RepoPath '.git'))) {
        Write-Err "A pasta '$RepoPath' nao e um repositorio Git."
        exit 1
    }
    Set-Location $RepoPath
}

# ---------------------------------------------------------------------------
# Coleta informacoes basicas do repositorio atual
# ---------------------------------------------------------------------------
function Get-RepoInfo {
    $branch = (git rev-parse --abbrev-ref HEAD 2>&1) | Select-Object -First 1
    $remote = (git remote get-url origin 2>&1)       | Select-Object -First 1

    $ahead  = 0
    $behind = 0
    try {
        $aheadRaw  = (git rev-list --count "origin/$branch..HEAD" 2>&1) | Select-Object -First 1
        $behindRaw = (git rev-list --count "HEAD..origin/$branch" 2>&1) | Select-Object -First 1
        if ($aheadRaw  -match '^\d+$') { $ahead  = [int]$aheadRaw  }
        if ($behindRaw -match '^\d+$') { $behind = [int]$behindRaw }
    } catch {}

    $statusLines = @(git status --porcelain 2>&1 | Where-Object { $_ -ne '' })

    return [PSCustomObject]@{
        Branch         = $branch
        Remote         = $remote
        LocalPath      = $RepoPath
        CommitsAhead   = $ahead
        CommitsBehind  = $behind
        HasUncommitted = ($statusLines.Count -gt 0)
        Uncommitted    = $statusLines
    }
}

# ---------------------------------------------------------------------------
# OPCAO 1 - Comparar local vs remoto
# ---------------------------------------------------------------------------
function Show-CompareStatus {
    Write-Header 'COMPARAR LOCAL vs REMOTO'
    Write-Info 'Buscando informacoes do remoto (git fetch)...'
    git fetch --quiet 2>&1 | Out-Null

    $info = Get-RepoInfo

    Write-Bold "Repositorio local : $($info.LocalPath)"
    Write-Bold "Remoto (origin)   : $($info.Remote)"
    Write-Bold "Branch atual      : $($info.Branch)"
    Write-Host ''

    if (($info.CommitsAhead -eq 0) -and ($info.CommitsBehind -eq 0)) {
        Write-OK 'Local e remoto estao SINCRONIZADOS.'
    }
    elseif ($info.CommitsAhead -gt 0) {
        Write-Warn "LOCAL esta $($info.CommitsAhead) commit(s) A FRENTE do remoto."
        Write-Info '-> O LOCAL esta mais atualizado. Use opcao 3 (push) para subir.'
    }
    elseif ($info.CommitsBehind -gt 0) {
        Write-Warn "LOCAL esta $($info.CommitsBehind) commit(s) ATRAS do remoto."
        Write-Info '-> O REMOTO esta mais atualizado. Use opcao 2 (pull) para baixar.'
    }
    else {
        Write-Warn "DIVERGENCIA: local +$($info.CommitsAhead) / remoto +$($info.CommitsBehind) commits."
        Write-Info '-> Necessario resolver conflito (merge ou rebase).'
    }

    if ($info.HasUncommitted) {
        Write-Host ''
        Write-Warn 'Ha alteracoes NAO commitadas no local:'
        foreach ($line in $info.Uncommitted) {
            Write-Host "     $line" -ForegroundColor DarkYellow
        }
    }

    Write-Host ''
    Write-Info 'Ultimos 5 commits LOCAIS:'
    git log --oneline -5 | ForEach-Object { Write-Host "    $_" -ForegroundColor Gray }

    Write-Host ''
    Write-Info "Ultimos 5 commits REMOTOS (origin/$($info.Branch)):"
    git log --oneline -5 "origin/$($info.Branch)" 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor Gray }
}

# ---------------------------------------------------------------------------
# OPCAO 2 - Pull
# ---------------------------------------------------------------------------
function Invoke-Pull {
    Write-Header 'BAIXAR DO REMOTO (pull)'
    $info = Get-RepoInfo

    if ($info.HasUncommitted) {
        Write-Warn 'Ha alteracoes nao commitadas. O pull pode gerar conflito.'
        $resp = Read-Host '  Continuar mesmo assim? (s/N)'
        if ($resp -notmatch '^[sS]$') { Write-Host '  Cancelado.'; return }
    }

    Write-Info "Executando: git pull origin $($info.Branch)"
    $out = git pull origin $info.Branch 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-OK 'Pull concluido com sucesso.'
        $out | ForEach-Object { Write-Host "  $_" -ForegroundColor Gray }
    }
    else {
        Write-Err 'Pull falhou:'
        $out | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
    }
}

# ---------------------------------------------------------------------------
# OPCAO 3 - Push
# ---------------------------------------------------------------------------
function Invoke-Push {
    Write-Header 'SUBIR PARA O REMOTO (push)'
    $info = Get-RepoInfo

    if ($info.CommitsAhead -eq 0) {
        Write-OK 'Nenhum commit local novo para enviar.'
        return
    }

    Write-Info "$($info.CommitsAhead) commit(s) serao enviados para origin/$($info.Branch)."
    $resp = Read-Host '  Confirmar push? (s/N)'
    if ($resp -notmatch '^[sS]$') { Write-Host '  Cancelado.'; return }

    Write-Info "Executando: git push origin $($info.Branch)"
    $out = git push origin $info.Branch 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-OK 'Push concluido com sucesso.'
        $out | ForEach-Object { Write-Host "  $_" -ForegroundColor Gray }
    }
    else {
        Write-Err 'Push falhou:'
        $out | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
    }
}

# ---------------------------------------------------------------------------
# OPCAO 4 - Listar branches
# ---------------------------------------------------------------------------
function Show-Branches {
    Write-Header 'BRANCHES'
    git fetch --quiet 2>&1 | Out-Null
    $current = (git rev-parse --abbrev-ref HEAD 2>&1) | Select-Object -First 1

    Write-Bold 'Branches LOCAIS:'
    git branch --format '%(refname:short) %(upstream:short)' | ForEach-Object {
        $parts    = ($_ -split '\s+', 2)
        $local    = $parts[0]
        $upstream = if ($parts.Count -gt 1 -and $parts[1] -ne '') { $parts[1] } else { '(sem tracking remoto)' }
        $marker   = if ($local -eq $current) { '  * ' } else { '    ' }
        $color    = if ($local -eq $current) { 'Green' } else { 'White' }
        Write-Host "$marker$local  ->  $upstream" -ForegroundColor $color
    }

    Write-Host ''
    Write-Bold 'Branches REMOTAS:'
    git branch -r --format '%(refname:short)' | ForEach-Object {
        Write-Host "    $_" -ForegroundColor Gray
    }
}

# ---------------------------------------------------------------------------
# OPCAO 5 - Trocar de branch
# ---------------------------------------------------------------------------
function Switch-Branch {
    Write-Header 'TROCAR DE BRANCH'
    git fetch --quiet 2>&1 | Out-Null

    $current    = (git rev-parse --abbrev-ref HEAD 2>&1) | Select-Object -First 1
    $localList  = @(git branch --format '%(refname:short)')
    $remoteList = @(git branch -r --format '%(refname:short)' | Where-Object { $_ -notmatch 'HEAD' })

    $allNames    = [System.Collections.Generic.List[string]]::new()
    $allIsRemote = [System.Collections.Generic.List[bool]]::new()
    $idx = 1

    Write-Bold 'Branches disponiveis:'
    Write-Host ''

    foreach ($b in $localList) {
        $label = if ($b -eq $current) { ' (ATUAL)' } else { '' }
        $color = if ($b -eq $current) { 'Green' } else { 'White' }
        Write-Host "  [$idx] $b$label" -ForegroundColor $color
        $allNames.Add($b)
        $allIsRemote.Add($false)
        $idx++
    }

    $remoteOnly = $remoteList | Where-Object {
        $short = $_ -replace '^origin/', ''
        $localList -notcontains $short
    }

    if ($remoteOnly.Count -gt 0) {
        Write-Host ''
        Write-Host '  --- Apenas no remoto (sera criada localmente ao selecionar) ---' -ForegroundColor DarkGray
        foreach ($b in $remoteOnly) {
            Write-Host "  [$idx] $b" -ForegroundColor Gray
            $allNames.Add($b)
            $allIsRemote.Add($true)
            $idx++
        }
    }

    Write-Host ''
    $choice = Read-Host '  Numero da branch (Enter = cancelar)'
    if ([string]::IsNullOrWhiteSpace($choice)) { Write-Host '  Cancelado.'; return }

    $n = [int]$choice - 1
    if ($n -lt 0 -or $n -ge $allNames.Count) { Write-Err 'Opcao invalida.'; return }

    $selectedName     = $allNames[$n]
    $selectedIsRemote = $allIsRemote[$n]
    $branchName       = $selectedName -replace '^origin/', ''

    if ($selectedIsRemote) {
        $out = git checkout -b $branchName --track $selectedName 2>&1
    }
    else {
        $out = git checkout $branchName 2>&1
    }

    if ($LASTEXITCODE -eq 0) {
        Write-OK "Trocado para branch '$branchName'."
    }
    else {
        Write-Err 'Falha ao trocar de branch:'
        $out | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
    }
}

# ---------------------------------------------------------------------------
# OPCAO 6 - Commit com mensagem aleatoria
# ---------------------------------------------------------------------------
function Invoke-RandomCommit {
    Write-Header 'COMMIT COM MENSAGEM ALEATORIA'

    $statusLines = @(git status --porcelain 2>&1 | Where-Object { $_ -ne '' })
    if ($statusLines.Count -eq 0) {
        Write-OK 'Nada para commitar - working tree limpa.'
        return
    }

    Write-Bold 'Alteracoes detectadas:'
    $statusLines | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkYellow }
    Write-Host ''

    $msg = $COMMIT_MESSAGES | Get-Random
    Write-Host "  Mensagem sorteada: $msg" -ForegroundColor Cyan
    $custom = Read-Host '  Pressione Enter para usar essa mensagem, ou digite outra'
    if (-not [string]::IsNullOrWhiteSpace($custom)) {
        $msg = $custom.Trim()
    }

    Write-Info 'Adicionando todos os arquivos (git add -A)...'
    git add -A 2>&1 | Out-Null

    $resp = Read-Host "  Confirmar commit? (s/N)"
    if ($resp -notmatch '^[sS]$') {
        git restore --staged . 2>&1 | Out-Null
        Write-Host '  Cancelado. Stage revertido.'
        return
    }

    $out = git commit -m $msg 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-OK "Commit criado: $msg"
        $out | ForEach-Object { Write-Host "  $_" -ForegroundColor Gray }
    }
    else {
        Write-Err 'Commit falhou:'
        $out | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
    }
}

# ---------------------------------------------------------------------------
# OPCAO 7 - Informacoes completas do repositorio
# ---------------------------------------------------------------------------
function Show-RepoInfo {
    Write-Header 'INFORMACOES DO REPOSITORIO'
    git fetch --quiet 2>&1 | Out-Null

    $info   = Get-RepoInfo
    $remAll = @(git remote -v 2>&1 | Select-String 'fetch' | ForEach-Object { $_.Line })

    Write-Bold "Caminho local     : $($info.LocalPath)"
    Write-Bold "Branch atual      : $($info.Branch)"
    Write-Bold "Remoto (origin)   : $($info.Remote)"
    Write-Host ''

    Write-Bold 'Todos os remotos cadastrados:'
    $remAll | ForEach-Object { Write-Host "  $_" -ForegroundColor Gray }
    Write-Host ''

    if (($info.CommitsAhead -eq 0) -and ($info.CommitsBehind -eq 0)) {
        $syncLabel = 'Sincronizado [OK]'
    }
    elseif ($info.CommitsAhead -gt 0) {
        $syncLabel = "Local +$($info.CommitsAhead) commit(s) a frente [PUSH necessario]"
    }
    else {
        $syncLabel = "Remoto +$($info.CommitsBehind) commit(s) a frente [PULL necessario]"
    }

    Write-Bold "Status de sync    : $syncLabel"
    Write-Bold "Commits a frente  : $($info.CommitsAhead)"
    Write-Bold "Commits atras     : $($info.CommitsBehind)"
    Write-Host ''

    if ($info.HasUncommitted) {
        Write-Warn 'Alteracoes nao commitadas:'
        $info.Uncommitted | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkYellow }
    }
    else {
        Write-OK 'Working tree limpa.'
    }

    Write-Host ''
    Write-Bold 'Configuracoes Git do usuario:'
    $gitName  = git config user.name  2>&1
    $gitEmail = git config user.email 2>&1
    Write-Host "  user.name  : $gitName"  -ForegroundColor Gray
    Write-Host "  user.email : $gitEmail" -ForegroundColor Gray
}

# ---------------------------------------------------------------------------
# Menu principal
# ---------------------------------------------------------------------------
function Show-Menu {
    $info = Get-RepoInfo

    if (($info.CommitsAhead -eq 0) -and ($info.CommitsBehind -eq 0)) {
        $syncStatus = '[OK] Sincronizado'
        $syncColor  = 'Green'
    }
    elseif ($info.CommitsAhead -gt 0) {
        $syncStatus = "[!] Local +$($info.CommitsAhead) a frente -> PUSH recomendado (opcao 3)"
        $syncColor  = 'Yellow'
    }
    else {
        $syncStatus = "[!] Remoto +$($info.CommitsBehind) a frente -> PULL recomendado (opcao 2)"
        $syncColor  = 'Yellow'
    }

    $uncommitedMsg = ''
    if ($info.HasUncommitted) {
        $uncommitedMsg = "  [!!] $($info.Uncommitted.Count) arquivo(s) com alteracoes nao commitadas"
    }

    Write-Header "GIT MANAGER  |  branch: $($info.Branch)"

    Write-Host "  Repo  : $($info.LocalPath)" -ForegroundColor Gray
    Write-Host "  Remote: $($info.Remote)"    -ForegroundColor Gray
    Write-Host "  Branch: $($info.Branch)"    -ForegroundColor Cyan
    Write-Host "  Sync  : $syncStatus"        -ForegroundColor $syncColor
    if ($uncommitedMsg -ne '') {
        Write-Host $uncommitedMsg -ForegroundColor Yellow
    }

    Write-Host ''
    Write-Host '  [1]  Comparar local vs remoto (qual esta mais atualizado)' -ForegroundColor White
    Write-Host '  [2]  Baixar do remoto (pull)'                              -ForegroundColor White
    Write-Host '  [3]  Subir para o remoto (push)'                           -ForegroundColor White
    Write-Host '  [4]  Listar branches'                                      -ForegroundColor White
    Write-Host '  [5]  Trocar de branch'                                     -ForegroundColor White
    Write-Host '  [6]  Commitar (mensagem aleatoria)'                        -ForegroundColor White
    Write-Host '  [7]  Informacoes completas do repositorio'                 -ForegroundColor White
    Write-Host '  [0]  Sair'                                                 -ForegroundColor DarkGray
    Write-Host ''
}

# ---------------------------------------------------------------------------
# Ponto de entrada
# ---------------------------------------------------------------------------
Assert-Repo

Write-Info 'Buscando estado do repositorio...'
git fetch --quiet 2>&1 | Out-Null

while ($true) {
    Clear-Host
    Show-Menu
    $opcao = Read-Host '  Escolha uma opcao'
    Write-Host ''

    switch ($opcao.Trim()) {
        '1' { Show-CompareStatus  }
        '2' { Invoke-Pull         }
        '3' { Invoke-Push         }
        '4' { Show-Branches       }
        '5' { Switch-Branch       }
        '6' { Invoke-RandomCommit }
        '7' { Show-RepoInfo       }
        '0' { Write-Host "`n  Ate logo!`n" -ForegroundColor Cyan; exit 0 }
        default { Write-Warn 'Opcao invalida. Digite um numero entre 0 e 7.' }
    }

    Write-Host ''
    Read-Host '  Pressione Enter para voltar ao menu'
}
