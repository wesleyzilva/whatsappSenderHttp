#Requires -Version 5.1
<#
.SYNOPSIS
    Gerenciador Git interativo para o repositorio imprimaMais.

.DESCRIPTION
    Menu completo organizado por fluxo de trabalho:
    
    VERIFICACAO:
      1. Comparar local vs remoto (qual esta mais atualizado)
      2. Informacoes completas do repositorio
      3. Listar branches
    
    SINCRONIZACAO:
      4. Trocar de branch
      5. Baixar do remoto (pull)
    
    ENVIAR ALTERACOES:
      6. Commitar com mensagem aleatoria
      7. Subir para o remoto (push)
    
    PUBLICACAO:
      8. Deploy para GitHub Pages (build + deploy)

        WORKSPACE:
            9. Baixar repositorio e adicionar ao workspace
            10. Remover repositorio do workspace
      
      0. Sair

.USAGE
    cd C:\repositorio\imprimaMais\gitCommands
    .\git-manager.ps1

    Ou informando outro caminho de repositorio:
    .\git-manager.ps1 -RepoPath "C:\outro\repo"
#>

param(
    [string]$RepoPath = (Split-Path $PSScriptRoot -Parent)
)

Set-StrictMode -Off
$ErrorActionPreference = 'Continue'

$WorkspaceRoot = Split-Path $RepoPath -Parent
$WorkspaceFile = Join-Path $WorkspaceRoot 'repositorios.code-workspace'

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
# Workspace do VS Code
# ---------------------------------------------------------------------------
function Get-WorkspaceData {
    if (-not (Test-Path $WorkspaceFile)) {
        return [PSCustomObject]@{
            folders  = @()
            settings = [PSCustomObject]@{}
        }
    }

    $raw = Get-Content -Path $WorkspaceFile -Raw -Encoding UTF8
    if ([string]::IsNullOrWhiteSpace($raw)) {
        return [PSCustomObject]@{
            folders  = @()
            settings = [PSCustomObject]@{}
        }
    }

    return $raw | ConvertFrom-Json
}

function Save-WorkspaceData {
    param([psobject]$WorkspaceData)

    $json = $WorkspaceData | ConvertTo-Json -Depth 10
    Set-Content -Path $WorkspaceFile -Value $json -Encoding UTF8
}

function Convert-ToWorkspaceRelativePath {
    param([string]$TargetPath)

    $workspaceRootResolved = [System.IO.Path]::GetFullPath($WorkspaceRoot)
    $targetResolved        = [System.IO.Path]::GetFullPath($TargetPath)

    if ($targetResolved.StartsWith($workspaceRootResolved, [System.StringComparison]::OrdinalIgnoreCase)) {
        $relative = $targetResolved.Substring($workspaceRootResolved.Length).TrimStart('\')
        if (-not [string]::IsNullOrWhiteSpace($relative)) {
            return $relative -replace '\\', '/'
        }
    }

    return $targetResolved
}

function Add-WorkspaceFolder {
    param(
        [string]$FolderPath,
        [string]$FolderName
    )

    $workspaceData = Get-WorkspaceData
    $relativePath  = Convert-ToWorkspaceRelativePath -TargetPath $FolderPath

    if (-not $FolderName) {
        $FolderName = Split-Path $FolderPath -Leaf
    }

    $alreadyExists = @($workspaceData.folders | Where-Object {
        $_.path -eq $relativePath -or $_.name -eq $FolderName
    }).Count -gt 0

    if ($alreadyExists) {
        Write-Warn "O repositorio '$FolderName' ja esta no workspace."
        return $false
    }

    $newFolders = @($workspaceData.folders)
    $newFolders += [PSCustomObject]@{
        name = $FolderName
        path = $relativePath
    }
    $workspaceData.folders = $newFolders
    Save-WorkspaceData -WorkspaceData $workspaceData
    Write-OK "Repositorio '$FolderName' adicionado ao workspace."
    return $true
}

function Remove-WorkspaceFolder {
    param([string]$FolderName)

    $workspaceData = Get-WorkspaceData
    $targetFolder  = @($workspaceData.folders | Where-Object {
        $_.name -eq $FolderName -or $_.path -eq $FolderName
    } | Select-Object -First 1)

    if ($targetFolder.Count -eq 0) {
        Write-Warn "Repositorio '$FolderName' nao foi encontrado no workspace."
        return $false
    }

    $workspaceData.folders = @($workspaceData.folders | Where-Object {
        $_.name -ne $targetFolder[0].name -and $_.path -ne $targetFolder[0].path
    })
    Save-WorkspaceData -WorkspaceData $workspaceData
    Write-OK "Repositorio '$($targetFolder[0].name)' removido do workspace."
    return $true
}

function Invoke-CloneAndAddToWorkspace {
    Write-Header 'BAIXAR REPOSITORIO E ADICIONAR AO WORKSPACE'
    Write-Bold "Workspace: $WorkspaceFile"
    Write-Bold "Pasta base: $WorkspaceRoot"
    Write-Host ''

    $repoUrl = Read-Host '  URL do repositorio Git (Enter = cancelar)'
    if ([string]::IsNullOrWhiteSpace($repoUrl)) {
        Write-Host '  Cancelado.'
        return
    }

    $defaultFolderName = [System.IO.Path]::GetFileNameWithoutExtension(($repoUrl.TrimEnd('/') -split '/')[-1])
    $folderNameInput   = Read-Host "  Nome da pasta local (Enter = $defaultFolderName)"
    $folderName        = if ([string]::IsNullOrWhiteSpace($folderNameInput)) { $defaultFolderName } else { $folderNameInput.Trim() }
    $targetPath        = Join-Path $WorkspaceRoot $folderName

    if (Test-Path $targetPath) {
        Write-Warn "A pasta '$targetPath' ja existe."
        if (Test-Path (Join-Path $targetPath '.git')) {
            $resp = Read-Host '  Deseja apenas adicionar ao workspace? (s/N)'
            if ($resp -match '^[sS]$') {
                Add-WorkspaceFolder -FolderPath $targetPath -FolderName $folderName | Out-Null
            }
        }
        else {
            Write-Err 'A pasta existe, mas nao parece ser um repositorio Git.'
        }
        return
    }

    Write-Info "Executando clone para '$targetPath'..."
    Push-Location $WorkspaceRoot
    try {
        $out = git clone $repoUrl $folderName 2>&1
    }
    finally {
        Pop-Location
    }

    if ($LASTEXITCODE -ne 0) {
        Write-Err 'Clone falhou:'
        $out | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
        return
    }

    Write-OK 'Clone concluido com sucesso.'
    Add-WorkspaceFolder -FolderPath $targetPath -FolderName $folderName | Out-Null
}

function Invoke-RemoveFromWorkspace {
    Write-Header 'REMOVER REPOSITORIO DO WORKSPACE'

    $workspaceData = Get-WorkspaceData
    $folders       = @($workspaceData.folders)

    if ($folders.Count -eq 0) {
        Write-Warn 'Nenhum repositorio encontrado no workspace.'
        return
    }

    Write-Bold 'Repositorios no workspace:'
    for ($i = 0; $i -lt $folders.Count; $i++) {
        Write-Host ("  [{0}] {1}  ->  {2}" -f ($i + 1), $folders[$i].name, $folders[$i].path) -ForegroundColor White
    }

    Write-Host ''
    $choice = Read-Host '  Numero do repositorio para remover (Enter = cancelar)'
    if ([string]::IsNullOrWhiteSpace($choice)) {
        Write-Host '  Cancelado.'
        return
    }

    $index = [int]$choice - 1
    if ($index -lt 0 -or $index -ge $folders.Count) {
        Write-Err 'Opcao invalida.'
        return
    }

    $selected = $folders[$index]
    $resp = Read-Host "  Confirmar remocao de '$($selected.name)' do workspace? (s/N)"
    if ($resp -notmatch '^[sS]$') {
        Write-Host '  Cancelado.'
        return
    }

    Remove-WorkspaceFolder -FolderName $selected.name | Out-Null
    Write-Info 'Os arquivos locais foram mantidos. Apenas o workspace foi atualizado.'
}

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
        Write-Info '-> O LOCAL esta mais atualizado. Use opcao 7 (push) para subir.'
    }
    elseif ($info.CommitsBehind -gt 0) {
        Write-Warn "LOCAL esta $($info.CommitsBehind) commit(s) ATRAS do remoto."
        Write-Info '-> O REMOTO esta mais atualizado. Use opcao 5 (pull) para baixar.'
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

function Invoke-SyncPush {
    Write-Header 'SINCRONIZAR (pull --rebase + push)'
    $info = Get-RepoInfo

    Write-Info 'Baixando alteracoes do remoto com rebase...'
    $pullOut = git pull --rebase origin $info.Branch 2>&1
    $pullOut | ForEach-Object { Write-Host "  $_" -ForegroundColor Gray }
    if ($LASTEXITCODE -ne 0) {
        Write-Err 'Pull/rebase falhou. Resolva os conflitos e tente novamente.'
        return
    }
    Write-OK 'Rebase concluido.'
    Write-Host ''

    $infoAfter = Get-RepoInfo
    if ($infoAfter.CommitsAhead -eq 0) {
        Write-OK 'Nenhum commit local para enviar apos o rebase.'
        return
    }

    Write-Info "$($infoAfter.CommitsAhead) commit(s) serao enviados para origin/$($infoAfter.Branch)."
    $resp = Read-Host '  Confirmar push? (s/N)'
    if ($resp -notmatch '^[sS]$') { Write-Host '  Cancelado.'; return }

    Write-Info "Executando: git push origin $($infoAfter.Branch)"
    $out = git push origin $infoAfter.Branch 2>&1
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
# OPCAO 8 - Deploy para GitHub Pages
# OPCAO 11 - Force Redeploy (republica sem checagens)
# ---------------------------------------------------------------------------
function Invoke-DeployPages {
    param([switch]$Force)
    Write-Header 'DEPLOY PARA GITHUB PAGES'

    $packageFile = Join-Path $RepoPath 'package.json'
    if (-not (Test-Path $packageFile)) {
        Write-Err 'package.json nao encontrado. Este nao parece ser um projeto Node.js.'
        return
    }

    # Descobrir scripts de deploy disponiveis no package.json
    $pkgJson    = Get-Content $packageFile -Raw | ConvertFrom-Json
    $allScripts = $pkgJson.scripts.PSObject.Properties.Name

    $deployOptions = [System.Collections.Generic.List[PSCustomObject]]::new()
    if ($allScripts -contains 'deploy:pages') {
        $deployOptions.Add([PSCustomObject]@{ Label = 'GitHub Pages (sem dominio proprio)'; Script = 'deploy:pages'; Color = 'Green' })
    }
    if ($allScripts -contains 'deploy:domain') {
        $deployOptions.Add([PSCustomObject]@{ Label = 'Dominio proprio (CNAME configurado)'; Script = 'deploy:domain'; Color = 'Yellow' })
    }
    # fallback: qualquer script que comece com 'deploy' e nao seja alias dos dois acima
    foreach ($s in ($allScripts | Where-Object { $_ -like 'deploy*' -and $_ -notin @('deploy:pages','deploy:domain') })) {
        $deployOptions.Add([PSCustomObject]@{ Label = $s; Script = $s; Color = 'Cyan' })
    }

    if ($deployOptions.Count -eq 0) {
        Write-Err 'Nenhum script de deploy encontrado no package.json.'
        return
    }

    $deployScript = $null
    if ($deployOptions.Count -eq 1) {
        $deployScript = $deployOptions[0].Script
        Write-Info "Usando: $deployScript"
    } else {
        $letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
        Write-Host '  Modalidade de deploy:' -ForegroundColor White
        for ($i = 0; $i -lt $deployOptions.Count; $i++) {
            $opt = $deployOptions[$i]
            $letter = $letters[$i]
            $default = if ($i -eq 0) { '   [padrao]' } else { '' }
            Write-Host "    $letter) $($opt.Label)$default" -ForegroundColor $opt.Color
        }
        Write-Host ''
        $deployMode = (Read-Host '  Escolha (Enter = A)').Trim().ToUpper()
        if ($deployMode -eq '') { $deployMode = 'A' }
        $idx = $letters.IndexOf($deployMode[0])
        if ($idx -lt 0 -or $idx -ge $deployOptions.Count) {
            Write-Err 'Opcao invalida. Cancelado.'
            return
        }
        $deployScript = $deployOptions[$idx].Script
        Write-Info "Modalidade: $($deployOptions[$idx].Label)"
    }
    Write-Host ''

    if ($Force) {
        Write-Warn 'Modo FORCE: ignorando checagem de arquivos nao commitados.'
    } else {
        Write-Info 'Verificando se ha alteracoes nao commitadas...'
        $statusLines = @(git status --porcelain 2>&1 | Where-Object { $_ -ne '' })
        if ($statusLines.Count -gt 0) {
            Write-Warn 'Ha alteracoes nao commitadas:'
            $statusLines | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkYellow }
            Write-Host ''
            $resp = Read-Host '  Deseja commitar antes do deploy? (s/N)'
            if ($resp -match '^[sS]$') {
                Invoke-RandomCommit
                Write-Host ''
            }
        }
    }

    Write-Info "Executando build e deploy ($deployScript)..."
    Set-Location $RepoPath
    $deployOut = npm run $deployScript 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-OK 'Deploy para GitHub Pages concluido com sucesso!'
        $deployOut | Select-Object -Last 10 | ForEach-Object { Write-Host "  $_" -ForegroundColor Gray }

        # Detectar URL de producao dinamicamente a partir do package.json / CNAME
        $siteUrl = $null

        $cnameFile = Join-Path $RepoPath 'public\CNAME'
        if (-not (Test-Path $cnameFile)) { $cnameFile = Join-Path $RepoPath 'CNAME' }
        if (Test-Path $cnameFile) {
            $cname = (Get-Content $cnameFile -Raw).Trim()
            if ($cname) { $siteUrl = "https://$cname/" }
        }

        if (-not $siteUrl) {
            $remote = (git remote get-url origin 2>&1) | Select-Object -First 1
            if ($remote -match 'github\.com[:/](.+?)(?:\.git)?$') {
                $slug  = $Matches[1]           # ex: wesleyzilva/dradaianaferraz_gold
                $parts = $slug -split '/'
                $siteUrl = "https://$($parts[0]).github.io/$($parts[1])/"
            }
        }

        Write-Host ''
        Write-Host '  ============================================' -ForegroundColor Cyan
        Write-Host '  VALIDACOES POS-DEPLOY' -ForegroundColor Cyan
        Write-Host '  ============================================' -ForegroundColor Cyan
        if ($siteUrl) {
            Write-Host "  Site publicado em: $siteUrl" -ForegroundColor White
            Write-Host ''
            Write-Host '  [1] Pagina principal (carregamento e visual)' -ForegroundColor Yellow
            Write-Host "      $siteUrl" -ForegroundColor Gray
            Write-Host ''
            Write-Host '  [2] Rich Results Test (schema.org / SEO estruturado)' -ForegroundColor Yellow
            Write-Host "      https://search.google.com/test/rich-results?url=$([Uri]::EscapeDataString($siteUrl))" -ForegroundColor Gray
            Write-Host ''
            Write-Host '  [3] PageSpeed / Core Web Vitals' -ForegroundColor Yellow
            Write-Host "      https://pagespeed.web.dev/analysis?url=$([Uri]::EscapeDataString($siteUrl))" -ForegroundColor Gray
            Write-Host ''
            Write-Host '  [4] LinkedIn Post Inspector (preview OG)' -ForegroundColor Yellow
            Write-Host "      https://www.linkedin.com/post-inspector/inspect/$([Uri]::EscapeDataString($siteUrl))" -ForegroundColor Gray
            Write-Host ''
            Write-Host '  [5] Google Search Console — Inspecionar URL' -ForegroundColor Yellow
            Write-Host '      https://search.google.com/search-console' -ForegroundColor Gray
        }
        Write-Host '  ============================================' -ForegroundColor Cyan
        Write-Host ''
    }
    else {
        Write-Err 'Deploy falhou:'
        $deployOut | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
    }
}

# ---------------------------------------------------------------------------
# OPCAO 13 - Force push para main (sobrescreve main com branch atual)
# ---------------------------------------------------------------------------
function Invoke-ForcePushToMain {
    Write-Header 'FORCE PUSH PARA MAIN'

    $info = Get-RepoInfo

    Write-Host '  ATENCAO: Esta operacao vai sobrescrever a branch main com a branch atual.' -ForegroundColor Red
    Write-Host "  Branch atual : $($info.Branch)" -ForegroundColor Cyan
    Write-Host '  Destino      : main (--force)' -ForegroundColor Yellow
    Write-Host ''

    if ($info.HasUncommitted) {
        Write-Warn "$($info.Uncommitted.Count) arquivo(s) com alteracoes nao commitadas."
        $resp = Read-Host '  Deseja commitar antes do force push? (s/N)'
        if ($resp -match '^[sS]$') {
            Invoke-RandomCommit
            Write-Host ''
        }
    }

    $resp = Read-Host "  Confirmar: git push --force origin $($info.Branch):main ? (s/N)"
    if ($resp -notmatch '^[sS]$') { Write-Host '  Cancelado.'; return }

    Write-Info "Executando: git push --force origin $($info.Branch):main"
    $out = git push --force origin "$($info.Branch):main" 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-OK "Force push para main concluido. Main agora espelha '$($info.Branch)'."
        $out | ForEach-Object { Write-Host "  $_" -ForegroundColor Gray }
    }
    else {
        Write-Err 'Force push falhou:'
        $out | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
    }
}

# ---------------------------------------------------------------------------
# OPCAO 14 - Renomear branch atual e/ou pasta local
# ---------------------------------------------------------------------------
function Invoke-Rename {
    Write-Header 'RENOMEAR BRANCH / PASTA LOCAL'

    $info = Get-RepoInfo

    Write-Host '  O que deseja renomear?' -ForegroundColor White
    Write-Host '  [A] Branch atual (local + remoto)'  -ForegroundColor Cyan
    Write-Host '  [B] Pasta local do repositorio'     -ForegroundColor Yellow
    Write-Host '  [C] Ambos (branch + pasta)'         -ForegroundColor Green
    Write-Host ''

    $choice = (Read-Host '  Escolha (Enter = cancelar)').Trim().ToUpper()
    if ($choice -eq '') { Write-Host '  Cancelado.'; return }
    if ($choice -notin @('A', 'B', 'C')) { Write-Err 'Opcao invalida.'; return }

    # ── Renomear branch ──────────────────────────────────────────────────────
    if ($choice -in @('A', 'C')) {
        $currentBranch = $info.Branch
        Write-Host ''
        Write-Host "  Branch atual: $currentBranch" -ForegroundColor Cyan
        $newBranch = (Read-Host '  Novo nome da branch (Enter = cancelar)').Trim()
        if ([string]::IsNullOrWhiteSpace($newBranch)) { Write-Host '  Cancelado.'; return }

        $outRename = git branch -m $currentBranch $newBranch 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-Err 'Falha ao renomear branch localmente:'
            $outRename | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
            return
        }
        Write-OK "Branch renomeada localmente: $currentBranch -> $newBranch"

        # Remove branch antiga do remoto (ignora erro se nao existir)
        git push origin ":$currentBranch" 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Write-OK "Branch remota '$currentBranch' removida."
        } else {
            Write-Warn "Branch remota '$currentBranch' nao encontrada (ignorado)."
        }

        $outPush = git push --set-upstream origin $newBranch 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-OK "Branch '$newBranch' publicada no remoto com tracking configurado."
        } else {
            Write-Err 'Falha ao publicar nova branch no remoto:'
            $outPush | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
        }
    }

    # ── Renomear pasta local ─────────────────────────────────────────────────
    if ($choice -in @('B', 'C')) {
        $currentFolder = Split-Path $RepoPath -Leaf
        $parentFolder  = Split-Path $RepoPath -Parent
        Write-Host ''
        Write-Host "  Pasta atual: $RepoPath" -ForegroundColor Cyan
        $newFolder = (Read-Host '  Novo nome da pasta (Enter = cancelar)').Trim()
        if ([string]::IsNullOrWhiteSpace($newFolder)) { Write-Host '  Cancelado.'; return }

        $newPath = Join-Path $parentFolder $newFolder
        if (Test-Path $newPath) {
            Write-Err "Ja existe uma pasta com o nome '$newFolder'."
            return
        }

        try {
            Rename-Item -Path $RepoPath -NewName $newFolder -ErrorAction Stop
            Write-OK "Pasta renomeada: $currentFolder -> $newFolder"

            # Atualiza workspace .code-workspace se existir
            $workspaceData = Get-WorkspaceData
            $folders = [System.Collections.Generic.List[object]]::new()
            $updated = $false
            foreach ($f in $workspaceData.folders) {
                if ($f.path -match [regex]::Escape($currentFolder)) {
                    $f.path = $f.path -replace [regex]::Escape($currentFolder), $newFolder
                    $updated = $true
                }
                if ($f.name -eq $currentFolder) {
                    $f.name = $newFolder
                    $updated = $true
                }
                $folders.Add($f)
            }
            if ($updated) {
                $workspaceData.folders = $folders
                Save-WorkspaceData -WorkspaceData $workspaceData
                Write-OK 'Workspace atualizado com o novo nome da pasta.'
            }

            Write-Host ''
            Write-Warn 'O script sera encerrado pois o caminho mudou.'
            Write-Info "Reabra o terminal em: $newPath\gitCommands"
        } catch {
            Write-Err "Falha ao renomear pasta: $_"
            return
        }
    }

    # ── Dica: renomear repo remoto ────────────────────────────────────────────
    Write-Host ''
    Write-Info 'Para renomear o REPOSITORIO no GitHub acesse:'
    $repoUrl = $info.Remote -replace '\.git$', ''
    Write-Host "      $repoUrl/settings" -ForegroundColor Gray
    Write-Host '  Settings > General > Repository name' -ForegroundColor Gray
    Write-Host '  Depois atualize o remote local com:' -ForegroundColor DarkGray
    Write-Host '      git remote set-url origin <nova-url>' -ForegroundColor DarkGray

    if ($choice -in @('B', 'C')) {
        Write-Host ''
        Read-Host '  Pressione Enter para encerrar'
        exit 0
    }
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
        $syncStatus = "[!] Local +$($info.CommitsAhead) a frente -> PUSH recomendado (opcao 7)"
        $syncColor  = 'Yellow'
    }
    else {
        $syncStatus = "[!] Remoto +$($info.CommitsBehind) a frente -> use opcao 5 (pull) ou 8 (sync)"
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
    Write-Host '  === VERIFICACAO ==='                                           -ForegroundColor Cyan
    Write-Host '  [1]  Comparar local vs remoto (qual esta mais atualizado)'   -ForegroundColor Cyan
    Write-Host '  [2]  Informacoes completas do repositorio'                   -ForegroundColor Cyan
    Write-Host '  [3]  Listar branches'                                        -ForegroundColor Cyan
    Write-Host ''
    Write-Host '  === SINCRONIZACAO ==='                                        -ForegroundColor Blue
    Write-Host '  [4]  Trocar de branch'                                       -ForegroundColor White
    Write-Host '  [5]  Baixar do remoto (pull)'                                -ForegroundColor White
    Write-Host ''
    Write-Host '  === ENVIAR ALTERACOES ==='                                    -ForegroundColor Yellow
    Write-Host '  [6]  Commitar (mensagem aleatoria)'                          -ForegroundColor Yellow
    Write-Host '  [7]  Subir para o remoto (push)'                             -ForegroundColor Green
    Write-Host '  [8]  Sincronizar (pull --rebase + push)'                     -ForegroundColor Yellow
    Write-Host ''
    Write-Host '  === PUBLICACAO ==='                                           -ForegroundColor Magenta
    Write-Host '  [9]  Deploy para GitHub Pages (build + deploy)'              -ForegroundColor Green
    Write-Host '  [10] Force Redeploy (republica sem perguntas)'               -ForegroundColor Magenta
    Write-Host ''
    Write-Host '  === WORKSPACE ==='                                            -ForegroundColor DarkCyan
    Write-Host '  [11] Baixar repositorio e adicionar ao workspace'            -ForegroundColor White
    Write-Host '  [12] Remover repositorio do workspace'                       -ForegroundColor White
    Write-Host ''
    Write-Host '  === AVANCADO ==='                                            -ForegroundColor Red
    Write-Host '  [13] Force push para main (sobrescreve main)'               -ForegroundColor Red
    Write-Host '  [14] Renomear branch / pasta local / repo remoto'           -ForegroundColor White
    Write-Host ''
    Write-Host '  [0]  Sair'                                                   -ForegroundColor DarkGray
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
        '1'  { Show-CompareStatus              }
        '2'  { Show-RepoInfo                   }
        '3'  { Show-Branches                   }
        '4'  { Switch-Branch                   }
        '5'  { Invoke-Pull                     }
        '6'  { Invoke-RandomCommit             }
        '7'  { Invoke-Push                     }
        '8'  { Invoke-SyncPush                 }
        '9'  { Invoke-DeployPages              }
        '10' { Invoke-DeployPages -Force       }
        '11' { Invoke-CloneAndAddToWorkspace   }
        '12' { Invoke-RemoveFromWorkspace      }
        '13' { Invoke-ForcePushToMain          }
        '14' { Invoke-Rename                   }
        '0'  { Write-Host "`n  Ate logo!`n" -ForegroundColor Cyan; exit 0 }
        default { Write-Warn 'Opcao invalida. Digite um numero entre 0 e 14.' }
    }

    Write-Host ''
    Read-Host '  Pressione Enter para voltar ao menu'
}
