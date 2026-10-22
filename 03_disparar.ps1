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
        Write-Host "  Campanha   : [!!] Nenhum CSV encontrado - use opcao [3] para gerar" -ForegroundColor Red
    } else {
        $c = $camp[0]
        $rot = Get-CampanhaRotulo $c
        $marca = if ($c.status -in @("concluida", "concluida_com_ressalvas", "aguardando_mes")) { "[!!]" } else { "[OK]" }
        Write-Host "  Campanha   : $marca $($c.arquivo) - $($rot[0])  (enviados $($c.enviados) | sem WhatsApp $($c.semWhatsapp) | falhas $($c.falhas) | pendentes $($c.pendentes))" -ForegroundColor $rot[1]
        if ($c.status -eq "concluida") {
            Write-Host "               Proxima campanha: gere uma nova lista (opcao 3)." -ForegroundColor DarkGray
        } elseif ($c.status -eq "concluida_com_ressalvas") {
            Write-Host "               Veja [19] fechamento e decida: retentar falhas [20] ou gerar nova lista [3]." -ForegroundColor DarkGray
        }
    }
    Write-Host "  Dica       : [A] mostra o que fazer agora  |  [H] explica cada opcao do menu" -ForegroundColor DarkGray
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
# Menu principal
# ---------------------------------------------------------------------------
function Show-Menu {
    Show-Banner
    Show-CSVAlert

    Write-Host "  === ROTINA DIARIA (comece por aqui) ===" -ForegroundColor Green
    Write-Host "  [A]  O que fazer agora (checklist do dia)"                     -ForegroundColor Green
    Write-Host "  [18] PAINEL no navegador (operar por botoes - recomendado)"    -ForegroundColor Green
    Write-Host "  [17] MODO CONTINUO - envia sozinho e encerra ao concluir"      -ForegroundColor Green
    Write-Host "  [1]  Ver status de envios (onde parou)"                        -ForegroundColor Green
    Write-Host "  [11] Ver numeros e saldo do dia"                               -ForegroundColor Green
    Write-Host "  [13] Conectar numero / adicionar zap (QR Code)"                -ForegroundColor Green
    Write-Host ""
    Write-Host "  === CAMPANHA ===" -ForegroundColor Yellow
    Write-Host "  [3]  Gerar lista de disparo (campanha + letra)"                -ForegroundColor Yellow
    Write-Host "  [19] Fechamento: a campanha terminou? pode ir para a proxima?" -ForegroundColor Yellow
    Write-Host "  [20] Retentar contatos que falharam"                           -ForegroundColor Yellow
    Write-Host "  [22] Convite para o grupo de promocoes (Harmonizacao Orofacial)" -ForegroundColor Yellow
    Write-Host "  [2]  Gerar relatorio de disparo"                               -ForegroundColor Yellow
    Write-Host "  [4]  Gerar listas Customer Match (Google Ads)"                 -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  === ENVIO MANUAL ===" -ForegroundColor Cyan
    Write-Host "  [5]  Enviar mensagens (disparo completo)"                      -ForegroundColor Cyan
    Write-Host "  [6]  Dry-run (simular sem enviar)"                             -ForegroundColor Cyan
    Write-Host "  [7]  Enviar com limite (parcial)"                              -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  === ZAPS (NUMEROS) - teto 48 envios por zap a cada 24h (limite 50 - margem 2) ===" -ForegroundColor Magenta
    Write-Host "  [12] Testar conexao com o zap"                                 -ForegroundColor Magenta
    Write-Host "  [14] Desconectar numero"                                       -ForegroundColor Magenta
    Write-Host "  [16] Atualizar biblioteca do WhatsApp (corrige autentica e nao conecta)" -ForegroundColor Magenta
    Write-Host ""
    Write-Host "  === GESTAO / TPM ===" -ForegroundColor White
    Write-Host "  [21] Relatorio de gestao (KPIs, perdas, riscos, recomendacoes)" -ForegroundColor White
    Write-Host "  [15] Ver log de erros"                                         -ForegroundColor White
    Write-Host ""
    Write-Host "  === MANUTENCAO ===" -ForegroundColor Red
    Write-Host "  [8]  Resetar historico de envios"                              -ForegroundColor DarkRed
    Write-Host "  [9]  Remover runId especifico"                                 -ForegroundColor DarkRed
    Write-Host "  [10] Exportar sem-WhatsApp para blacklist"                     -ForegroundColor DarkRed
    Write-Host ""
    Write-Host "  [H] Guia: o que cada opcao faz e o que posso verificar"        -ForegroundColor DarkGray
    Write-Host "  [0] Sair"                                                      -ForegroundColor DarkGray
    Write-Host ""
}

function Show-Guia {
    Write-Host "  ================= GUIA DO MENU =================" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  ROTINA DIARIA (secretaria)" -ForegroundColor Green
    Write-Host "   [A]  Lista o que precisa ser feito AGORA: zaps sem conexao, campanha terminada, falhas, erros."
    Write-Host "   [18] Abre o painel no navegador com 4 abas: Operacao, Campanhas, Gestao (TPM) e Guia rapido."
    Write-Host "   [17] Liga o envio continuo: usa os zaps conectados, respeita o teto de 24h e ENCERRA quando a lista acaba."
    Write-Host "   [1]  Status geral: total enviado, por zap, por categoria e por dia."
    Write-Host "   [11] Saldo de cada numero: enviados nas ultimas 24h e quando libera a proxima vaga."
    Write-Host "   [13] Le o QR Code para conectar (ou reconectar) um numero. Enter cancela."
    Write-Host ""
    Write-Host "  CAMPANHA" -ForegroundColor Yellow
    Write-Host "   [3]  Gera uma lista nova (deduplica por telefone/mes e aplica a blacklist)."
    Write-Host "   [19] FECHAMENTO: mostra enviados, sem WhatsApp, falhas e pendentes e diz se pode seguir para a proxima campanha."
    Write-Host "   [20] Devolve para a fila os contatos que falharam (faz backup do log antes)."
    Write-Host "   [22] Monta a lista de convite para o grupo de promocoes a partir do link do grupo."
    Write-Host "   [2]  Relatorio de execucoes anteriores e progresso de um arquivo."
    Write-Host "   [4]  Exporta contatos enviados para o Google Ads (Customer Match)."
    Write-Host ""
    Write-Host "  ENVIO MANUAL" -ForegroundColor Cyan
    Write-Host "   [5] envia a lista escolhida | [6] simula sem enviar | [7] envia so uma quantidade."
    Write-Host ""
    Write-Host "  ZAPS" -ForegroundColor Magenta
    Write-Host "   [12] testa a conexao | [14] apaga a sessao de um numero | [16] atualiza a biblioteca (quando nao conecta)."
    Write-Host ""
    Write-Host "  GESTAO / TPM" -ForegroundColor White
    Write-Host "   [21] Relatorio completo: funil, vazao por dia, saude dos zaps, desperdicio, riscos e proximas acoes."
    Write-Host "   [15] Erros dos ultimos 7 dias."
    Write-Host ""
    Write-Host "  MANUTENCAO" -ForegroundColor Red
    Write-Host "   [8] apaga TODO o historico (perigoso!) | [9] remove uma execucao | [10] manda numeros sem WhatsApp para a blacklist."
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

# ---------------------------------------------------------------------------
# Loop principal
# ---------------------------------------------------------------------------
while ($true) {
    Show-Menu
    $op = Read-Host "  Opcao"
    Write-Host ""

    switch ($op.Trim()) {

        # ---- VERIFICACAO ----

        "1" {
            node "$DIR\02_sender.js" --status
            Write-Host ""
            Read-Host "  Pressione Enter para voltar"
        }

        "2" {
            $csv = Select-CSV
            Write-Host ""
            if ($csv) {
                Write-Host "  Relatorio: $([System.IO.Path]::GetFileName($csv))" -ForegroundColor Cyan
                Write-Host ""
                node "$DIR\02_sender.js" "$csv" --resumo
            } else {
                node "$DIR\02_sender.js" --resumo
            }
            Write-Host ""
            Read-Host "  Pressione Enter para voltar"
        }

        # ---- PREPARACAO ----

        "3" {
            # Campanha
            $idCampanha = Select-Campanha
            Write-Host ""
            Write-Host "  Campanha selecionada: $idCampanha" -ForegroundColor Cyan

            # Segmento (letra)
            Write-Host ""
            Write-Host "  Segmento: letra inicial do nome do contato (A, B, C...) ou TODAS" -ForegroundColor Gray
            $segmento = Read-Host "  Segmento (Enter = A)"
            if ([string]::IsNullOrWhiteSpace($segmento)) { $segmento = "A" }
            $segmento = $segmento.ToUpper()

            # Debug
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
                Write-Host "  Use [5] para enviar por DDD ou [6] para dry-run." -ForegroundColor DarkGray
            }
            Write-Host ""
            Read-Host "  Pressione Enter para voltar"
        }

        "4" {
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
            Write-Host ""
            Read-Host "  Pressione Enter para voltar"
        }

        # ---- ENVIO ----

        "5" {
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
            Write-Host ""
            Read-Host "  Pressione Enter para voltar"
        }

        "6" {
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
            Write-Host ""
            Read-Host "  Pressione Enter para voltar"
        }

        "7" {
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
            Write-Host ""
            Read-Host "  Pressione Enter para voltar"
        }

        # ---- MANUTENCAO ----

        "8" {
            Write-Host "  ATENCAO: Isso vai apagar TODO o historico de envios." -ForegroundColor Red
            $confirm = Read-Host "  Confirma? (s/N)"
            if ($confirm -ieq "s") {
                node "$DIR\02_sender.js" --reset
                Write-Host ""
                Write-Host "  Historico resetado." -ForegroundColor Green
            } else {
                Write-Host "  Cancelado." -ForegroundColor Yellow
            }
            Write-Host ""
            Read-Host "  Pressione Enter para voltar"
        }

        "9" {
            $runId = Read-Host "  Informe o runId a remover (ex: 2026-04-08T14-30-00)"
            if (-not [string]::IsNullOrWhiteSpace($runId)) {
                node "$DIR\02_sender.js" "--reset-run=$runId"
            } else {
                Write-Host "  RunId invalido." -ForegroundColor Red
            }
            Write-Host ""
            Read-Host "  Pressione Enter para voltar"
        }

        # ---- ROTINA / GESTAO ----

        "a" {
            node "$DIR\06_gestao.js" --hoje
            Read-Host "  Pressione Enter para voltar"
        }

        "h" {
            Show-Guia
            Read-Host "  Pressione Enter para voltar"
        }

        "19" {
            $csv = Select-CSV
            Write-Host ""
            if ($csv) { node "$DIR\06_gestao.js" --fechamento "$csv" }
            Read-Host "  Pressione Enter para voltar"
        }

        "20" {
            $csv = Select-CSV
            Write-Host ""
            if ($csv) { node "$DIR\06_gestao.js" --retentar-falhas "$csv" }
            Write-Host ""
            Read-Host "  Pressione Enter para voltar"
        }

        "21" {
            $dias = Read-Host "  Quantos dias analisar? (Enter = 14)"
            if ($dias -notmatch "^\d+$") { $dias = "14" }
            node "$DIR\06_gestao.js" --gestao "--dias=$dias"
            Read-Host "  Pressione Enter para voltar"
        }

        "22" {
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
            Write-Host ""
            Read-Host "  Pressione Enter para voltar"
        }

        # ---- SAIR ----

        "0" {
            Write-Host "  Ate logo!" -ForegroundColor Yellow
            Write-Host ""
            exit 0
        }

        "10" {
            Write-Host "  Exportando numeros sem WhatsApp para blacklist..." -ForegroundColor Magenta
            Write-Host ""
            node "$DIR\02_sender.js" --export-blacklist
            Write-Host ""
            Read-Host "  Pressione Enter para voltar"
        }

        # ---- ZAPS (NUMEROS) ----

        "11" {
            node "$DIR\02_sender.js" --zaps
            Write-Host ""
            Read-Host "  Pressione Enter para voltar"
        }

        "12" {
            $sel = Read-Host "  Zap para testar (numero, ex: 1; Enter = todos)"
            if ([string]::IsNullOrWhiteSpace($sel)) {
                node "$DIR\02_sender.js" --testar
            } else {
                node "$DIR\02_sender.js" "--testar=$($sel.Trim())"
            }
            Write-Host ""
            Read-Host "  Pressione Enter para voltar"
        }

        "13" {
            node "$DIR\02_sender.js" --conectar
            Write-Host ""
            Read-Host "  Pressione Enter para voltar"
        }

        "14" {
            node "$DIR\02_sender.js" --desconectar
            Write-Host ""
            Read-Host "  Pressione Enter para voltar"
        }

        "15" {
            node "$DIR\02_sender.js" --erros
            Write-Host ""
            Read-Host "  Pressione Enter para voltar"
        }

        "16" {
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
            Write-Host ""
            Read-Host "  Pressione Enter para voltar"
        }

        "17" {
            Write-Host "  MODO CONTINUO: o programa fica rodando, envia ate o teto de cada zap," -ForegroundColor Green
            Write-Host "  e ENCERRA sozinho quando a campanha terminar (mostrando o fechamento)." -ForegroundColor Green
            Write-Host "  passa para o proximo zap e, se nenhum estiver livre, ESPERA (nao executa) ate a vaga abrir." -ForegroundColor Green
            Write-Host "  Para parar com seguranca: digite P e Enter na janela do envio." -ForegroundColor DarkGray
            Write-Host ""
            $csvC = $null
            $usaMaisRecente = Read-Host "  Usar sempre o CSV mais recente da pasta 02_disparos? (S/n)"
            if ($usaMaisRecente -imatch '^n') { $csvC = Select-CSV; if (-not $csvC) { Read-Host "  Pressione Enter para voltar"; continue } }
            $arqRef = if ($csvC) { $csvC } else { $recentes = @(Get-Campanhas 1); if ($recentes.Count -gt 0) { $recentes[0].arquivo } else { "" } }
            $dddPad = if ($arqRef) { Get-DefaultDdd $arqRef } else { "16" }
            $ddd    = Read-DDD -Default $dddPad
            $extraC = @(Read-EnvioArgs)
            $argsC  = @()
            if ($csvC) { $argsC += "$csvC" }
            $argsC += @(Get-DddArg $ddd)
            $argsC += $extraC
            & "$DIR\03a_continuo.ps1" @argsC
            Write-Host ""
            Read-Host "  Pressione Enter para voltar"
        }

        "18" {
            Write-Host "  Painel em http://localhost:3737  (Ctrl+C para fechar)" -ForegroundColor Green
            node "$DIR\04_painel.js"
            Write-Host ""
            Read-Host "  Pressione Enter para voltar"
        }

        default {
            Write-Host "  Opcao invalida." -ForegroundColor Red
            Write-Host ""
            Read-Host "  Pressione Enter para voltar"
        }
    }
}
