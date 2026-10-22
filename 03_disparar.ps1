# WhatsApp Sender - Menu de Controle
# Dra. Daiana Ferraz - Responsavel: Wesley Silva

$Host.UI.RawUI.WindowTitle = "WhatsApp Sender - Dra. Daiana Ferraz"
$DIR = $PSScriptRoot

# ---------------------------------------------------------------------------
# Helpers de exibicao
# ---------------------------------------------------------------------------
function Show-Banner {
    Clear-Host
    Write-Host ""
    Write-Host "  ==========================================" -ForegroundColor Yellow
    Write-Host "    WhatsApp Sender - Dra. Daiana Ferraz   " -ForegroundColor Yellow
    Write-Host "  ==========================================" -ForegroundColor Yellow
    Write-Host ""
}

# Lista de campanhas (CSVs de 02_disparos) ja analisadas pelo 06_gestao.js. Limite 0 = todas.
function Get-Campanhas {
    param([int]$Limite = 0)
    $arg = if ($Limite -gt 0) { "--csvs=$Limite" } else { "--csvs" }
    try {
        $json = (& node "$DIR\06_gestao.js" $arg 2>$null | Out-String).Trim()
        if ([string]::IsNullOrWhiteSpace($json)) { return @() }
        $obj = ConvertFrom-Json -InputObject $json
        return @($obj)
    } catch { return @() }
}

function Get-CampanhaRotulo {
    param($c)
    switch ($c.status) {
        "concluida"               { return @("CONCLUIDA 100%", "Green") }
        "concluida_com_ressalvas" { return @("CONCLUIDA COM RESSALVAS ($($c.falhas) falhas)", "Yellow") }
        "em_andamento"            { return @("EM ANDAMENTO $($c.pctProcessado)%", "Cyan") }
        "nao_iniciada"            { return @("nao iniciada", "DarkGray") }
        "aguardando_mes"          { return @("AGUARDA VIRADA DO MES", "Yellow") }
        default                   { return @("vazia", "DarkRed") }
    }
}

function Show-CSVAlert {
    Write-Host "  Data atual : $(Get-Date -Format 'dd/MM/yyyy  HH:mm')" -ForegroundColor Gray
    $zapsLinha = & node "$DIR\02_sender.js" --zaps-resumo 2>$null
    if ($zapsLinha) { Write-Host "  $zapsLinha" -ForegroundColor Gray }
    $camp = @(Get-Campanhas 1)
    if ($camp.Count -eq 0) {
        Write-Host "  Campanha   : [!!] Nenhum CSV encontrado - use [C1] para gerar" -ForegroundColor Red
    } else {
        $c = $camp[0]
        $rot = Get-CampanhaRotulo $c
        $marca = if ($c.status -in @("concluida", "concluida_com_ressalvas", "aguardando_mes")) { "[!!]" } else { "[OK]" }
        Write-Host "  Campanha   : $marca $($c.arquivo) - $($rot[0])  (enviados $($c.enviados) | sem WhatsApp $($c.semWhatsapp) | falhas $($c.falhas) | pendentes $($c.pendentes))" -ForegroundColor $rot[1]
        if ($c.status -eq "concluida") {
            Write-Host "               Proxima campanha: gere uma nova lista [C1]." -ForegroundColor DarkGray
        } elseif ($c.status -eq "concluida_com_ressalvas") {
            Write-Host "               Veja [C2] fechamento e decida: retentar falhas [C3] ou gerar nova lista [C1]." -ForegroundColor DarkGray
        }
    }
    Write-Host ""
}

# ---------------------------------------------------------------------------
# Extrai info do nome do CSV: campanha, segmento (letra), data
# Formato: lista_{id_campanha}_{LETRA}_{YYYYMMDD}.csv
# Backward-compat: lista_disparos_{LETRA}_{YYYYMMDD}.csv
# ---------------------------------------------------------------------------
function Parse-CsvMeta ($fileName) {
    # Novo formato
    if ($fileName -match '^lista_(.+)_([A-Z]{1,5})_(\d{8})\.csv$') {
        $d = $Matches[3]
        return @{
            campanha = $Matches[1]
            segmento = $Matches[2]
            data     = "$($d.Substring(6,2))/$($d.Substring(4,2))/$($d.Substring(0,4))"
        }
    }
    # Legado: lista_disparos_C_20260422.csv
    if ($fileName -match '^lista_disparos_([A-Z]{1,5})_(\d{8})\.csv$') {
        $d = $Matches[2]
        return @{
            campanha = "legado"
            segmento = $Matches[1]
            data     = "$($d.Substring(6,2))/$($d.Substring(4,2))/$($d.Substring(0,4))"
        }
    }
    return @{ campanha = "?"; segmento = "?"; data = "?" }
}

# ---------------------------------------------------------------------------
# Selecionar arquivo CSV com meta-info
# ---------------------------------------------------------------------------
function Select-CSV {
    $totalArquivos = @(Get-ChildItem -Path "$DIR\02_disparos" -Filter "*.csv" -ErrorAction SilentlyContinue).Count
    if ($totalArquivos -eq 0) {
        Write-Host "  Nenhum CSV encontrado em .\02_disparos\" -ForegroundColor Red
        return $null
    }
    $todas = $false
    while ($true) {
        $lista = @(Get-Campanhas $(if ($todas) { 0 } else { 3 }))
        if ($lista.Count -eq 0) {
            Write-Host "  Nao consegui ler as listas (verifique o Node.js)." -ForegroundColor Red
            return $null
        }
        $titulo = if ($todas) { "Todas as listas (mais recentes primeiro):" } else { "As 3 listas mais recentes (as demais ficam no log / opcao T):" }
        Write-Host "  $titulo" -ForegroundColor Cyan
        $i = 1
        foreach ($c in $lista) {
            $rot = Get-CampanhaRotulo $c
            $idade = if ($c.idadeH -lt 24) { "recente" } else { "$($c.idadeH)h atras" }
            Write-Host "  [$i] $($c.arquivo)   <$($rot[0])>" -ForegroundColor $rot[1]
            Write-Host "      campanha: $($c.campanha)  |  segmento: $($c.segmento)  |  gerado: $($c.dataArquivo) ($idade)  |  $($c.unicos) contatos unicos" -ForegroundColor DarkGray
            if ($c.unicos -gt 0) {
                Write-Host "      enviados: $($c.enviados)  |  sem WhatsApp: $($c.semWhatsapp)  |  falhas: $($c.falhas)  |  pendentes: $($c.pendentes)" -ForegroundColor DarkGray
            }
            $i++
        }
        if (-not $todas -and $totalArquivos -gt $lista.Count) {
            Write-Host "  [T] Ver todas as listas ($totalArquivos)" -ForegroundColor Yellow
        }
        Write-Host ""
        $sel = Read-Host "  Selecione o numero do arquivo (Enter = [1] mais recente)"
        if ($sel -ieq "t" -and -not $todas) { $todas = $true; Write-Host ""; continue }
        if ([string]::IsNullOrWhiteSpace($sel)) { $sel = "1" }
        if ($sel -match "^\d+$" -and [int]$sel -ge 1 -and [int]$sel -le $lista.Count) {
            return (Join-Path "$DIR\02_disparos" $lista[[int]$sel - 1].arquivo)
        }
        Write-Host "  Opcao invalida." -ForegroundColor Red
        return $null
    }
}

# ---------------------------------------------------------------------------
# Selecionar / definir ID de campanha
# ---------------------------------------------------------------------------
function Select-Campanha {
    # Extrai campanhas unicas dos CSVs existentes
    $csvFiles = Get-ChildItem -Path "$DIR\02_disparos" -Filter "*.csv" -ErrorAction SilentlyContinue |
                Sort-Object LastWriteTime -Descending
    $campanhas = @()
    foreach ($f in $csvFiles) {
        $meta = Parse-CsvMeta $f.Name
        if ($meta.campanha -ne "?" -and $meta.campanha -ne "legado" -and $campanhas -notcontains $meta.campanha) {
            $campanhas += $meta.campanha
        }
    }

    Write-Host ""
    if ($campanhas.Count -gt 0) {
        Write-Host "  Campanhas com CSVs ja gerados:" -ForegroundColor Cyan
        $i = 1
        foreach ($c in $campanhas) {
            Write-Host "  [$i] $c" -ForegroundColor Cyan
            $i++
        }
        Write-Host "  [N] Criar nova campanha" -ForegroundColor Yellow
        Write-Host ""
        $sel = Read-Host "  Selecione (numero ou N)"
        if ($sel -match "^\d+$" -and [int]$sel -ge 1 -and [int]$sel -le $campanhas.Count) {
            return $campanhas[[int]$sel - 1]
        }
    }

    # Nova campanha
    $ano = (Get-Date).Year
    Write-Host ""
    Write-Host "  Formato: YYYY_campanha_nome_do_disparo" -ForegroundColor Gray
    Write-Host "  Exemplo: ${ano}_campanha_aquecimento_whatsapp" -ForegroundColor DarkGray
    Write-Host ""
    $nova = Read-Host "  Nome da campanha (Enter = ${ano}_campanha_aquecimento_whatsapp)"
    if ([string]::IsNullOrWhiteSpace($nova)) {
        $nova = "${ano}_campanha_aquecimento_whatsapp"
    }
    # Normaliza: minusculo, espacos -> underscore
    $nova = $nova.Trim().ToLower() -replace '\s+', '_'
    return $nova
}

# ---------------------------------------------------------------------------
# Pede DDD (com default)
# ---------------------------------------------------------------------------
function Read-DDD {
    param([string]$Default = "16")
    $resp = Read-Host "  DDD prioritario (Enter = $Default, ou 'todos' para nao filtrar)"
    if ([string]::IsNullOrWhiteSpace($resp)) { return $Default }
    if ($resp -ieq "todos") { return "" }
    return $resp.Trim()
}

function Get-DefaultDdd {
    param([string]$CsvPath)
    if ([System.IO.Path]::GetFileName($CsvPath) -match '^lista_patoBranco_PB_\d{8}\.csv$') {
        return "46"
    }
    return "16"
}

# ---------------------------------------------------------------------------
# Pergunta modo (sequencial/paralelo) e quais zaps usar no envio
# ---------------------------------------------------------------------------
function Read-EnvioArgs {
    Write-Host ""
    $modo  = Read-Host "  Modo: [S]equencial (um zap por vez) ou [P]aralelo (todos juntos)? (Enter = padrao)"
    $chips = Read-Host "  Quais zaps usar? ex: 1,3  (Enter = todos os ativos)"
    $out = @()
    if ($modo -imatch '^p')     { $out += "--modo=paralelo" }
    elseif ($modo -imatch '^s') { $out += "--modo=sequencial" }
    if (-not [string]::IsNullOrWhiteSpace($chips)) { $out += "--chips=$($chips -replace '\s','')" }
    return $out
}

# ---------------------------------------------------------------------------
# Estrutura do menu: AREAS -> opcoes. A chave de cada opcao e LETRA+NUMERO (ex.: C2).
# Pode digitar a chave direto no menu principal (ex.: "c2"), sem abrir a area.
# ---------------------------------------------------------------------------
$SECOES = [ordered]@{
    O = @{ Nome = "OPERACAO DIARIA"; Cor = "Green"; Desc = "Rotina da secretaria: enviar e acompanhar"; Itens = @(
        @{ N = "1"; Id = "continuo"; Txt = "Iniciar ENVIO CONTINUO";        Dica = "envia sozinho e encerra ao concluir a campanha" },
        @{ N = "2"; Id = "status";   Txt = "Status de envios";                Dica = "onde parou: total, por zap, por dia" },
        @{ N = "3"; Id = "saldo";    Txt = "Numeros e saldo do dia";          Dica = "quantos cada zap ainda pode enviar" }
    ) }
    C = @{ Nome = "CAMPANHAS"; Cor = "Yellow"; Desc = "Listas de contatos, fechamento e convites"; Itens = @(
        @{ N = "1"; Id = "gerar-lista";   Txt = "Gerar lista de disparo";            Dica = "campanha + letra; ja tira blacklist e duplicados" },
        @{ N = "2"; Id = "fechamento";    Txt = "Fechamento da campanha";            Dica = "terminou? posso ir para a proxima?" },
        @{ N = "3"; Id = "retentar";      Txt = "Retentar contatos que falharam";    Dica = "devolve as falhas para a fila (faz backup)" },
        @{ N = "4"; Id = "convite";       Txt = "Convite para o grupo de promocoes"; Dica = "Harmonizacao Orofacial - Pato Branco" },
        @{ N = "5"; Id = "rel-disparo";   Txt = "Relatorio de disparo";              Dica = "progresso de um arquivo" },
        @{ N = "6"; Id = "customer-match"; Txt = "Listas Customer Match";            Dica = "exporta para o Google Ads" }
    ) }
    E = @{ Nome = "ENVIO MANUAL"; Cor = "Cyan"; Desc = "Quando nao for usar o modo continuo"; Itens = @(
        @{ N = "1"; Id = "enviar";   Txt = "Enviar mensagens (disparo completo)"; Dica = "usa a lista escolhida" },
        @{ N = "2"; Id = "dry-run";  Txt = "Dry-run (simular sem enviar)";        Dica = "mostra o plano, nao envia nada" },
        @{ N = "3"; Id = "limite";   Txt = "Enviar com limite";                   Dica = "so uma quantidade nesta execucao" }
    ) }
    Z = @{ Nome = "ZAPS (NUMEROS)"; Cor = "Magenta"; Desc = "Teto: 48 envios por zap a cada 24h (limite 50 - margem 2)"; Itens = @(
        @{ N = "1"; Id = "conectar";    Txt = "Conectar numero / adicionar zap"; Dica = "le o QR Code" },
        @{ N = "2"; Id = "testar";      Txt = "Testar conexao com o zap";         Dica = "confere se esta online" },
        @{ N = "3"; Id = "desconectar"; Txt = "Desconectar numero";               Dica = "apaga a sessao do zap" },
        @{ N = "4"; Id = "atualizar-lib"; Txt = "Atualizar biblioteca do WhatsApp"; Dica = "corrige 'autentica e nao conecta'" }
    ) }
    G = @{ Nome = "GESTAO / TPM"; Cor = "White"; Desc = "Visao do projeto: indicadores, riscos e decisoes (nao opera nada)"; Itens = @(
        @{ N = "1"; Id = "gestao";     Txt = "Relatorio de gestao";              Dica = "funil, vazao, saude dos zaps, perdas, riscos" },
        @{ N = "2"; Id = "erros";      Txt = "Log de erros";                     Dica = "ultimos 7 dias, traduzidos" },
        @{ N = "3"; Id = "painel-tpm"; Txt = "Abrir PAINEL DE GESTAO no navegador"; Dica = "visao TPM, separada da operacao" }
    ) }
    M = @{ Nome = "MANUTENCAO"; Cor = "Red"; Desc = "Cuidado: acoes que apagam ou alteram o historico"; Itens = @(
        @{ N = "1"; Id = "reset";          Txt = "Resetar TODO o historico de envios"; Dica = "perigoso" },
        @{ N = "2"; Id = "remover-run";    Txt = "Remover uma execucao (runId)";       Dica = "desfaz um lote" },
        @{ N = "3"; Id = "exportar-bl";    Txt = "Exportar sem-WhatsApp para blacklist"; Dica = "evita tentar de novo" }
    ) }
}

# Atalhos antigos (menu numerado) -> chave nova. Quem ja sabe "19" continua chegando la.
$LEGADO = @{
    "1" = "O2"; "2" = "C5"; "3" = "C1"; "4" = "C6"; "5" = "E1"; "6" = "E2"; "7" = "E3"; "8" = "M1"; "9" = "M2"; "10" = "M3"
    "11" = "O3"; "12" = "Z2"; "13" = "Z1"; "14" = "Z3"; "15" = "G2"; "16" = "Z4"; "17" = "O1"; "18" = "P"
    "19" = "C2"; "20" = "C3"; "21" = "G1"; "22" = "C4"
}

function Find-Item {
    param([string]$Letra, [string]$Num)
    $k = $Letra.ToUpper()
    if (-not $SECOES.Contains($k)) { return $null }
    foreach ($i in $SECOES[$k].Itens) { if ($i.N -eq $Num) { return $i } }
    return $null
}

function Write-Opcao {
    param([string]$Chave, [string]$Txt, [string]$Dica, [string]$Cor)
    $rot = "[$Chave]".PadRight(6)
    Write-Host "   $rot" -NoNewline -ForegroundColor $Cor
    Write-Host " $Txt" -NoNewline -ForegroundColor $Cor
    if ($Dica) { Write-Host "  - $Dica" -ForegroundColor DarkGray } else { Write-Host "" }
}

function Get-Semaforo {
    try {
        $json = (& node "$DIR\06_gestao.js" --semaforo 2>$null | Out-String).Trim()
        if ([string]::IsNullOrWhiteSpace($json)) { return $null }
        return (ConvertFrom-Json -InputObject $json)
    } catch { return $null }
}

# ---------------------------------------------------------------------------
# Telas
# ---------------------------------------------------------------------------
function Show-Principal {
    Show-Banner
    Show-CSVAlert
    $sem = Get-Semaforo
    if ($sem) {
        if ($sem.urgentes -gt 0) {
            Write-Host "  Agora      : [!!] $($sem.urgentes) urgente(s) | $($sem.atencao) atencao | $($sem.info) info  -> digite A para ver o que fazer" -ForegroundColor Red
        } elseif ($sem.atencao -gt 0) {
            Write-Host "  Agora      : [! ] $($sem.atencao) atencao | $($sem.info) info  -> digite A para ver" -ForegroundColor Yellow
        } else {
            Write-Host "  Agora      : [OK] nada urgente ($($sem.info) informativo(s))" -ForegroundColor Green
        }
        Write-Host ""
    }

    Write-Host "  ROTINA DO DIA" -ForegroundColor Green
    Write-Opcao "A"  "O que fazer agora"                "checklist com as tarefas pendentes" "Green"
    Write-Opcao "O1" "Iniciar envio continuo"           "envia sozinho e encerra ao concluir" "Green"
    Write-Opcao "Z1" "Conectar numero (QR Code)"        "quando um zap pedir" "Green"
    Write-Opcao "P"  "Painel OPERACIONAL no navegador"  "botoes em vez de comandos" "Green"
    Write-Host ""
    Write-Host "  AREAS (digite a letra para abrir)" -ForegroundColor White
    foreach ($k in $SECOES.Keys) {
        $s = $SECOES[$k]
        Write-Host "   [$k]  " -NoNewline -ForegroundColor $s.Cor
        Write-Host ($s.Nome.PadRight(18)) -NoNewline -ForegroundColor $s.Cor
        Write-Host " $($s.Desc)" -ForegroundColor DarkGray
    }
    Write-Host ""
    Write-Host "   [H]  Guia das opcoes        [0]  Sair" -ForegroundColor DarkGray
    Write-Host "   Atalho: digite a chave direta, ex.: C2 (fechamento da campanha), G1 (relatorio de gestao)." -ForegroundColor DarkGray
    Write-Host ""
}

function Show-Secao {
    param([string]$Letra)
    $s = $SECOES[$Letra]
    Clear-Host
    Write-Host ""
    Write-Host "  WhatsApp Sender  >  " -NoNewline -ForegroundColor DarkGray
    Write-Host $s.Nome -ForegroundColor $s.Cor
    Write-Host "  $($s.Desc)" -ForegroundColor DarkGray
    Write-Host "  ------------------------------------------------------------" -ForegroundColor DarkGray
    Write-Host ""
    foreach ($i in $s.Itens) { Write-Opcao "$Letra$($i.N)" $i.Txt $i.Dica $s.Cor }
    Write-Host ""
    Write-Host "   [V]  Voltar ao menu principal   (ou Enter)" -ForegroundColor DarkGray
    Write-Host "   Dica: digite so o numero (ex.: $($s.Itens[0].N)) ou troque de area digitando outra letra." -ForegroundColor DarkGray
    Write-Host ""
}

function Show-Guia {
    Write-Host "  ================= GUIA DO MENU =================" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  COMO NAVEGAR" -ForegroundColor White
    Write-Host "   - Menu principal: digite a LETRA da area (O, C, E, Z, G, M) para abrir a lista de opcoes."
    Write-Host "   - Dentro da area: digite o numero da opcao. [V] ou Enter volta. Voce fica na area para encadear passos."
    Write-Host "   - Atalho: digite a chave completa no menu principal (ex.: C2). Os numeros do menu antigo (19, 21...) ainda funcionam."
    Write-Host ""
    Write-Host "  ROTINA DO DIA (secretaria)" -ForegroundColor Green
    Write-Host "   [A]  Lista o que precisa ser feito AGORA: zaps sem conexao, campanha terminada, falhas, erros."
    Write-Host "   [P]  Painel OPERACIONAL no navegador (aba Operacional): botoes para iniciar/parar, zaps, campanhas."
    Write-Host "   [O1] Envio continuo: usa os zaps conectados, respeita o teto de 24h e ENCERRA quando a lista acaba."
    Write-Host "   [O2] Status geral. [O3] Saldo de cada numero e quando libera a proxima vaga."
    Write-Host "   [Z1] Le o QR Code para conectar (ou reconectar) um numero. Enter cancela."
    Write-Host ""
    Write-Host "  CAMPANHAS [C]" -ForegroundColor Yellow
    Write-Host "   [C1] Gera uma lista nova (deduplica por telefone/mes e aplica a blacklist)."
    Write-Host "   [C2] FECHAMENTO: enviados, sem WhatsApp, falhas e pendentes; diz se pode seguir para a proxima campanha."
    Write-Host "   [C3] Devolve para a fila os contatos que falharam (faz backup do log antes)."
    Write-Host "   [C4] Monta a lista de convite para o grupo de promocoes a partir do link do grupo."
    Write-Host "   [C5] Relatorio de execucoes anteriores e progresso de um arquivo. [C6] Exporta para o Google Ads."
    Write-Host ""
    Write-Host "  ENVIO MANUAL [E]" -ForegroundColor Cyan
    Write-Host "   [E1] envia a lista escolhida | [E2] simula sem enviar | [E3] envia so uma quantidade."
    Write-Host ""
    Write-Host "  ZAPS [Z]" -ForegroundColor Magenta
    Write-Host "   [Z2] testa a conexao | [Z3] apaga a sessao de um numero | [Z4] atualiza a biblioteca (quando nao conecta)."
    Write-Host ""
    Write-Host "  GESTAO / TPM [G]  (visao do projeto, separada da operacao)" -ForegroundColor White
    Write-Host "   [G1] Relatorio completo: funil, vazao por dia, saude dos zaps, desperdicio, riscos e proximas acoes."
    Write-Host "   [G2] Erros dos ultimos 7 dias. [G3] Painel de GESTAO no navegador (aba TPM)."
    Write-Host ""
    Write-Host "  MANUTENCAO [M]" -ForegroundColor Red
    Write-Host "   [M1] apaga TODO o historico (perigoso!) | [M2] remove uma execucao | [M3] manda numeros sem WhatsApp para a blacklist."
    Write-Host ""
    Write-Host "  REGRAS AUTOMATICAS" -ForegroundColor Gray
    Write-Host "   - 48 envios por zap a cada 24h; 1 mensagem por telefone por mes; blacklist nunca recebe."
    Write-Host "   - Zap desconectado ou em quarentena nao e tentado. Apos 2 falhas de conexao seguidas: quarentena de 6h."
    Write-Host "   - Modo continuo nao usa listas de meses anteriores (evita reenvio) e encerra quando a campanha termina."
    Write-Host "   - Documentacao completa: docs\OPERACAO_SECRETARIA.md (rotina) e docs\GESTAO_TPM.md (gestao)."
    Write-Host ""
}

# ---------------------------------------------------------------------------
# Constroi args de DDD para o node
# ---------------------------------------------------------------------------
function Get-DddArg {
    param([string]$Ddd)
    if ([string]::IsNullOrWhiteSpace($Ddd)) { return @() }
    return @("--ddd=$Ddd")
}

function Wait-Enter { Write-Host ""; Read-Host "  Pressione Enter para voltar" | Out-Null }

# ---------------------------------------------------------------------------
# Interpreta o que foi digitado. Devolve @{ tipo; ... }
#   tipo: nada | sair | voltar | secao | acao | invalida
# ---------------------------------------------------------------------------
function Resolve-Entrada {
    param([string]$Texto, [string]$Atual)
    $t = $Texto.Trim().ToLower()
    $areas = ($SECOES.Keys -join "").ToLower()

    if ($t -eq "") { if ($Atual) { return @{ tipo = "voltar" } } else { return @{ tipo = "nada" } } }
    if ($t -in @("sair", "q", "s")) { return @{ tipo = "sair" } }
    if ($t -eq "0") { if ($Atual) { return @{ tipo = "voltar" } } else { return @{ tipo = "sair" } } }
    if ($t -in @("v", "voltar")) { if ($Atual) { return @{ tipo = "voltar" } } else { return @{ tipo = "nada" } } }
    if ($t -eq "a") { return @{ tipo = "acao"; id = "hoje" } }
    if ($t -eq "h") { return @{ tipo = "acao"; id = "guia" } }
    if ($t -eq "p") { return @{ tipo = "acao"; id = "painel-op" } }

    if ($t.Length -eq 1 -and $areas.Contains($t)) { return @{ tipo = "secao"; chave = $t.ToUpper() } }

    if ($t -match '^([a-z])\s*(\d+)$' -and $areas.Contains($Matches[1])) {
        $i = Find-Item $Matches[1] $Matches[2]
        if ($i) { return @{ tipo = "acao"; id = $i.Id } }
        return @{ tipo = "invalida" }
    }

    if ($t -match '^\d+$') {
        if ($Atual) {
            $i = Find-Item $Atual $t
            if ($i) { return @{ tipo = "acao"; id = $i.Id } }
            return @{ tipo = "invalida" }
        }
        if ($LEGADO.ContainsKey($t)) {
            $novo = $LEGADO[$t]
            if ($novo -eq "P") { return @{ tipo = "acao"; id = "painel-op"; aviso = "O atalho antigo [$t] agora e [P]." } }
            $i = Find-Item $novo.Substring(0, 1) $novo.Substring(1)
            return @{ tipo = "acao"; id = $i.Id; aviso = "O atalho antigo [$t] agora e [$novo]." }
        }
    }
    return @{ tipo = "invalida" }
}

# ---------------------------------------------------------------------------
# Acoes (cada uma termina sozinha; o loop faz a pausa)
# ---------------------------------------------------------------------------
function Invoke-Acao {
    param([string]$Id)

    switch ($Id) {

        "hoje"  { node "$DIR\06_gestao.js" --hoje }
        "guia"  { Show-Guia }

        "painel-op" {
            Write-Host "  Painel OPERACIONAL em http://localhost:3737  (Ctrl+C para fechar)" -ForegroundColor Green
            node "$DIR\04_painel.js" --visao=op
        }
        "painel-tpm" {
            Write-Host "  Painel de GESTAO (TPM) em http://localhost:3737#tpm  (Ctrl+C para fechar)" -ForegroundColor Green
            node "$DIR\04_painel.js" --visao=tpm
        }

        # ---- OPERACAO DIARIA ----
        "continuo" {
            Write-Host "  ENVIO CONTINUO: o programa fica rodando, envia ate o teto de cada zap," -ForegroundColor Green
            Write-Host "  e ENCERRA sozinho quando a campanha terminar (mostrando o fechamento)." -ForegroundColor Green
            Write-Host "  Passa para o proximo zap e, se nenhum estiver livre, ESPERA ate a vaga abrir." -ForegroundColor Green
            Write-Host "  Para parar com seguranca: digite P e Enter na janela do envio." -ForegroundColor DarkGray
            Write-Host ""
            $csvC = $null
            $usaMaisRecente = Read-Host "  Usar sempre o CSV mais recente da pasta 02_disparos? (S/n)"
            if ($usaMaisRecente -imatch '^n') { $csvC = Select-CSV; if (-not $csvC) { return } }
            $arqRef = if ($csvC) { $csvC } else { $recentes = @(Get-Campanhas 1); if ($recentes.Count -gt 0) { $recentes[0].arquivo } else { "" } }
            $dddPad = if ($arqRef) { Get-DefaultDdd $arqRef } else { "16" }
            $ddd    = Read-DDD -Default $dddPad
            $extraC = @(Read-EnvioArgs)
            $argsC  = @()
            if ($csvC) { $argsC += "$csvC" }
            $argsC += @(Get-DddArg $ddd)
            $argsC += $extraC
            & "$DIR\03a_continuo.ps1" @argsC
        }
        "status" { node "$DIR\02_sender.js" --status }
        "saldo"  { node "$DIR\02_sender.js" --zaps }

        # ---- CAMPANHAS ----
        "gerar-lista" {
            $idCampanha = Select-Campanha
            Write-Host ""
            Write-Host "  Campanha selecionada: $idCampanha" -ForegroundColor Cyan

            Write-Host ""
            Write-Host "  Segmento: letra inicial do nome do contato (A, B, C...) ou TODAS" -ForegroundColor Gray
            $segmento = Read-Host "  Segmento (Enter = A)"
            if ([string]::IsNullOrWhiteSpace($segmento)) { $segmento = "A" }
            $segmento = $segmento.ToUpper()

            $debugFlag = Read-Host "  Ativar debug? (s/N)"
            $debugArg  = if ($debugFlag -ieq "s") { "--debug" } else { "" }

            Write-Host ""
            Write-Host "  Gerando CSV..." -ForegroundColor Magenta
            Write-Host "  Campanha : $idCampanha" -ForegroundColor DarkGray
            Write-Host "  Segmento : $segmento" -ForegroundColor DarkGray
            Write-Host ""

            if ($debugArg) {
                python "$DIR\01_gerar_lista.py" "--id-campanha=$idCampanha" "--campanha=$segmento" $debugArg
            } else {
                python "$DIR\01_gerar_lista.py" "--id-campanha=$idCampanha" "--campanha=$segmento"
            }

            if ($LASTEXITCODE -ne 0) {
                Write-Host ""
                Write-Host "  ERRO ao gerar lista. Verifique Python e o script." -ForegroundColor Red
            } else {
                Write-Host ""
                Write-Host "  CSV gerado em .\02_disparos\" -ForegroundColor Green
                Write-Host "  Proximo passo: [E2] dry-run ou [O1] envio continuo." -ForegroundColor DarkGray
            }
        }
        "fechamento" {
            $csv = Select-CSV
            Write-Host ""
            if ($csv) { node "$DIR\06_gestao.js" --fechamento "$csv" }
        }
        "retentar" {
            $csv = Select-CSV
            Write-Host ""
            if ($csv) { node "$DIR\06_gestao.js" --retentar-falhas "$csv" }
        }
        "convite" {
            Write-Host "  Convite para o grupo de promocoes de Harmonizacao Orofacial (Pato Branco)." -ForegroundColor Cyan
            Write-Host "  Modelo da mensagem: 01_fontes\mensagem_grupo_harmonizacao.txt" -ForegroundColor DarkGray
            Write-Host "  No WhatsApp: abra o grupo > Convidar via link > Copiar link." -ForegroundColor DarkGray
            Write-Host ""
            $link = Read-Host "  Cole o link do grupo (https://chat.whatsapp.com/...)"
            if (-not [string]::IsNullOrWhiteSpace($link)) {
                $dddG = Read-Host "  DDD dos contatos (Enter = 46)"
                if ($dddG -notmatch "^\d{2}$") { $dddG = "46" }
                node "$DIR\06_gestao.js" --convite-grupo "--link=$($link.Trim())" "--ddd=$dddG"
            }
        }
        "rel-disparo" {
            $csv = Select-CSV
            Write-Host ""
            if ($csv) {
                Write-Host "  Relatorio: $([System.IO.Path]::GetFileName($csv))" -ForegroundColor Cyan
                Write-Host ""
                node "$DIR\02_sender.js" "$csv" --resumo
            } else {
                node "$DIR\02_sender.js" --resumo
            }
        }
        "customer-match" {
            Write-Host "  Gerando listas para Customer Match (Google Ads)..." -ForegroundColor Magenta
            Write-Host ""
            python "$DIR\04_publico\04_gerar_customer_match.py"
            if ($LASTEXITCODE -ne 0) {
                Write-Host ""
                Write-Host "  ERRO: Falha ao gerar listas para Customer Match" -ForegroundColor Red
            } else {
                Write-Host ""
                Write-Host "  Listas geradas em .\04_publico\" -ForegroundColor Green
            }
        }

        # ---- ENVIO MANUAL ----
        "enviar" {
            $csv = Select-CSV
            if ($csv) {
                Write-Host ""
                $ddd    = Read-DDD -Default (Get-DefaultDdd $csv)
                $dddArg = Get-DddArg $ddd
                $extra  = @(Read-EnvioArgs)
                $label  = if ($ddd) { "DDD $ddd" } else { "todos os DDDs" }
                Write-Host ""
                Write-Host "  Iniciando envio: $([System.IO.Path]::GetFileName($csv))  [$label]" -ForegroundColor Green
                Write-Host ""
                $nodeArgs = @("$csv") + @($dddArg) + $extra
                node "$DIR\02_sender.js" @nodeArgs
            }
        }
        "dry-run" {
            $csv = Select-CSV
            if ($csv) {
                Write-Host ""
                $ddd    = Read-DDD -Default (Get-DefaultDdd $csv)
                $dddArg = Get-DddArg $ddd
                $extra  = @(Read-EnvioArgs)
                $label  = if ($ddd) { "DDD $ddd" } else { "todos os DDDs" }
                Write-Host ""
                Write-Host "  Dry-run: $([System.IO.Path]::GetFileName($csv))  [$label]" -ForegroundColor Cyan
                Write-Host ""
                $nodeArgs = @("$csv", "--dry-run") + @($dddArg) + $extra
                node "$DIR\02_sender.js" @nodeArgs
            }
        }
        "limite" {
            $csv = Select-CSV
            if ($csv) {
                Write-Host ""
                $ddd    = Read-DDD -Default (Get-DefaultDdd $csv)
                $dddArg = Get-DddArg $ddd
                $extra  = @(Read-EnvioArgs)
                $limite = Read-Host "  Quantos envios nesta execucao?"
                if ($limite -match "^\d+$") {
                    $label = if ($ddd) { "DDD $ddd" } else { "todos os DDDs" }
                    Write-Host ""
                    Write-Host "  Enviando ate $limite mensagens  [$label]..." -ForegroundColor Green
                    Write-Host ""
                    $nodeArgs = @("$csv", "--limit=$limite") + @($dddArg) + $extra
                    node "$DIR\02_sender.js" @nodeArgs
                } else {
                    Write-Host "  Numero invalido." -ForegroundColor Red
                }
            }
        }

        # ---- ZAPS ----
        "conectar"    { node "$DIR\02_sender.js" --conectar }
        "testar" {
            $sel = Read-Host "  Zap para testar (numero, ex: 1; Enter = todos)"
            if ([string]::IsNullOrWhiteSpace($sel)) {
                node "$DIR\02_sender.js" --testar
            } else {
                node "$DIR\02_sender.js" "--testar=$($sel.Trim())"
            }
        }
        "desconectar" { node "$DIR\02_sender.js" --desconectar }
        "atualizar-lib" {
            Write-Host ""
            Write-Host "  Versao instalada da biblioteca:" -ForegroundColor Cyan
            Push-Location $DIR
            npm ls whatsapp-web.js --depth=0
            Write-Host ""
            Write-Host "  (Feche todas as outras janelas do disparador antes de atualizar.)" -ForegroundColor Yellow
            $r = Read-Host "  Atualizar para a ultima versao agora? (s/N)"
            if ($r -imatch '^s') {
                npm install whatsapp-web.js@latest
                Write-Host ""
                Write-Host "  Versao instalada agora:" -ForegroundColor Cyan
                npm ls whatsapp-web.js --depth=0
            }
            Pop-Location
        }

        # ---- GESTAO / TPM ----
        "gestao" {
            $dias = Read-Host "  Quantos dias analisar? (Enter = 14)"
            if ($dias -notmatch "^\d+$") { $dias = "14" }
            node "$DIR\06_gestao.js" --gestao "--dias=$dias"
        }
        "erros" { node "$DIR\02_sender.js" --erros }

        # ---- MANUTENCAO ----
        "reset" {
            Write-Host "  ATENCAO: Isso vai apagar TODO o historico de envios." -ForegroundColor Red
            $confirm = Read-Host "  Confirma? (s/N)"
            if ($confirm -ieq "s") {
                node "$DIR\02_sender.js" --reset
                Write-Host ""
                Write-Host "  Historico resetado." -ForegroundColor Green
            } else {
                Write-Host "  Cancelado." -ForegroundColor Yellow
            }
        }
        "remover-run" {
            $runId = Read-Host "  Informe o runId a remover (ex: 2026-04-08T14-30-00)"
            if (-not [string]::IsNullOrWhiteSpace($runId)) {
                node "$DIR\02_sender.js" "--reset-run=$runId"
            } else {
                Write-Host "  RunId invalido." -ForegroundColor Red
            }
        }
        "exportar-bl" {
            Write-Host "  Exportando numeros sem WhatsApp para blacklist..." -ForegroundColor Magenta
            Write-Host ""
            node "$DIR\02_sender.js" --export-blacklist
        }
    }
}

# ---------------------------------------------------------------------------
# Loop principal: menu principal <-> area. A area continua aberta depois de cada acao.
# ---------------------------------------------------------------------------
$atual = $null
while ($true) {
    if ($atual) { Show-Secao $atual } else { Show-Principal }
    $dica = if ($atual) { "$($SECOES[$atual].Nome) > Opcao" } else { "Opcao" }
    $entrada = Read-Host "  $dica"
    Write-Host ""
    $r = Resolve-Entrada $entrada $atual

    if ($r.tipo -eq "sair") {
        Write-Host "  Ate logo!" -ForegroundColor Yellow
        Write-Host ""
        exit 0
    }
    elseif ($r.tipo -eq "voltar") { $atual = $null }
    elseif ($r.tipo -eq "secao")  { $atual = $r.chave }
    elseif ($r.tipo -eq "acao") {
        if ($r.aviso) { Write-Host "  ($($r.aviso))" -ForegroundColor DarkGray; Write-Host "" }
        Invoke-Acao $r.id
        Wait-Enter
    }
    elseif ($r.tipo -eq "invalida") {
        Write-Host "  Opcao invalida. Digite a letra de uma area (O, C, E, Z, G, M), a chave (ex.: C2) ou H para o guia." -ForegroundColor Red
        Start-Sleep -Milliseconds 1200
    }
}
