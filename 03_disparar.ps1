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

function Show-CSVAlert {
    $csvFiles = Get-ChildItem -Path "$DIR\02_disparos" -Filter "*.csv" -ErrorAction SilentlyContinue |
                Sort-Object LastWriteTime -Descending
    Write-Host "  Data atual : $(Get-Date -Format 'dd/MM/yyyy  HH:mm')" -ForegroundColor Gray
    if ($csvFiles.Count -eq 0) {
        Write-Host "  Lista CSV  : [!!] Nenhum CSV encontrado — use opcao [3] para gerar" -ForegroundColor Red
    } else {
        $newest = $csvFiles[0]
        $age    = (Get-Date) - $newest.LastWriteTime
        if ($age.TotalHours -ge 24) {
            Write-Host "  Lista CSV  : [!!] $($newest.Name)  ($([int]$age.TotalHours)h atras) — CSV antigo, gere nova lista (opcao 3)" -ForegroundColor Yellow
        } else {
            Write-Host "  Lista CSV  : [OK] $($newest.Name)  (recente)" -ForegroundColor Green
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
    $csvFiles = Get-ChildItem -Path "$DIR\02_disparos" -Filter "*.csv" -ErrorAction SilentlyContinue |
                Sort-Object LastWriteTime -Descending
    if ($csvFiles.Count -eq 0) {
        Write-Host "  Nenhum CSV encontrado em .\02_disparos\" -ForegroundColor Red
        return $null
    }

    # Carrega sent_log uma vez para calcular breakdown por status
    # $sentLog[chave] = "sent" | "failed" | "skipped_not_registered" | ...
    $sentLog = @{}
    $sentLogPath = "$DIR\03_log\sent_log.json"
    if (Test-Path $sentLogPath) {
        try {
            $obj = Get-Content $sentLogPath -Raw -Encoding UTF8 | ConvertFrom-Json
            $obj.PSObject.Properties | ForEach-Object { $sentLog[$_.Name] = $_.Value.status }
        } catch {}
    }

    Write-Host "  Arquivos disponiveis (mais recentes primeiro):" -ForegroundColor Cyan
    $i = 1
    foreach ($file in $csvFiles) {
        $age      = (Get-Date) - $file.LastWriteTime
        $ageLabel = if ($age.TotalHours -lt 24) { "recente" } else { "$([int]$age.TotalHours)h atras" }
        $color    = if ($age.TotalHours -lt 24) { "Green" } else { "DarkYellow" }
        $meta     = Parse-CsvMeta $file.Name

        # Le linhas nao-vazias (mais rapido que Import-Csv para grandes arquivos)
        $allLines  = [System.IO.File]::ReadAllLines($file.FullName, [System.Text.Encoding]::UTF8)
        $dataLines = $allLines | Where-Object { $_.Trim() -ne "" }
        $registros = [Math]::Max(0, $dataLines.Count - 1)
        $tamanho   = if ($file.Length -ge 1MB) { "{0:N1} MB" -f ($file.Length / 1MB) } `
                     elseif ($file.Length -ge 1KB) { "{0:N0} KB" -f ($file.Length / 1KB) } `
                     else { "$($file.Length) B" }

        # Calcula breakdown cruzando com sent_log (chave: numero_YYYYMM)
        $statusEnvio = ""
        $statusColor = "DarkGray"
        $mesLog = if ($file.Name -match '_(\d{6})\d{2}\.csv$') { $Matches[1] } else { "" }
        if ($registros -gt 0 -and $mesLog -ne "" -and $sentLog.Count -gt 0) {
            $header = ($dataLines[0] -split ',') | ForEach-Object { $_.Trim().Trim('"') }
            $numIdx = [Array]::IndexOf([string[]]$header, 'numero')
            $qSent = 0; $qFailed = 0; $qSkipped = 0
            if ($numIdx -ge 0) {
                for ($li = 1; $li -lt $dataLines.Count; $li++) {
                    $cols = $dataLines[$li] -split ','
                    if ($cols.Count -gt $numIdx) {
                        $tel = ($cols[$numIdx].Trim().Trim('"')) -replace '\D', ''
                        if ($tel -ne "") {
                            $st = $sentLog["${tel}_${mesLog}"]
                            switch ($st) {
                                "sent"                   { $qSent++ }
                                "failed"                 { $qFailed++ }
                                "skipped_not_registered" { $qSkipped++ }
                            }
                        }
                    }
                }
            }
            $tocados = $qSent + $qFailed + $qSkipped
            $pct = if ($registros -gt 0) { [int]($tocados * 100 / $registros) } else { 0 }
            if ($tocados -eq 0) {
                $statusEnvio = "  [nenhum enviado]"
                $statusColor = "DarkGray"
            } elseif ($tocados -eq $registros) {
                $statusEnvio = "  [CONCLUIDO] ✅$qSent ⚠️$qSkipped ❌$qFailed"
                $statusColor = if ($qFailed -gt 0 -or $qSkipped -gt 0) { "Yellow" } else { "Green" }
            } else {
                $statusEnvio = "  [$tocados/$registros - $pct%] ✅$qSent ⚠️$qSkipped ❌$qFailed"
                $statusColor = if ($pct -ge 50) { "Yellow" } else { "DarkYellow" }
            }
        } elseif ($registros -eq 0) {
            $statusEnvio = "  [vazio]"
            $statusColor = "DarkRed"
        }

        Write-Host "  [$i] $($file.Name)" -ForegroundColor $color
        Write-Host -NoNewline "      campanha: $($meta.campanha)  |  segmento: $($meta.segmento)  |  gerado: $($meta.data)  ($ageLabel)  |  $registros registros  |  $tamanho" -ForegroundColor DarkGray
        Write-Host $statusEnvio -ForegroundColor $statusColor
        $i++
    }
    Write-Host ""
    $sel = Read-Host "  Selecione o numero do arquivo"
    if ($sel -match "^\d+$" -and [int]$sel -ge 1 -and [int]$sel -le $csvFiles.Count) {
        return $csvFiles[[int]$sel - 1].FullName
    } else {
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

# ---------------------------------------------------------------------------
# Menu principal
# ---------------------------------------------------------------------------
function Show-Menu {
    Show-Banner
    Show-CSVAlert

    Write-Host "  === VERIFICACAO ===" -ForegroundColor Cyan
    Write-Host "  [1] Ver status de envios (onde parou)"           -ForegroundColor Cyan
    Write-Host "  [2] Gerar relatorio de disparo"                  -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  === PREPARACAO ===" -ForegroundColor Yellow
    Write-Host "  [3] Gerar lista de disparo (campanha + letra)"   -ForegroundColor Yellow
    Write-Host "  [4] Gerar listas Customer Match (Google Ads)"    -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  === ENVIO ===" -ForegroundColor Green
    Write-Host "  [5] Enviar mensagens (disparo completo)"         -ForegroundColor Green
    Write-Host "  [6] Dry-run (simular sem enviar)"                -ForegroundColor Green
    Write-Host "  [7] Enviar com limite (parcial)"                 -ForegroundColor Green
    Write-Host ""
    Write-Host "  === MANUTENCAO ===" -ForegroundColor Red
    Write-Host "  [8]  Resetar historico de envios"                -ForegroundColor DarkRed
    Write-Host "  [9]  Remover runId especifico"                   -ForegroundColor DarkRed
    Write-Host "  [10] Exportar sem-WhatsApp para blacklist"       -ForegroundColor DarkRed
    Write-Host ""
    Write-Host "  [0] Sair"                                        -ForegroundColor DarkGray
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
                $ddd    = Read-DDD
                $dddArg = Get-DddArg $ddd
                $label  = if ($ddd) { "DDD $ddd" } else { "todos os DDDs" }
                Write-Host ""
                Write-Host "  Iniciando envio: $([System.IO.Path]::GetFileName($csv))  [$label]" -ForegroundColor Green
                Write-Host ""
                if ($dddArg.Count -gt 0) {
                    node "$DIR\02_sender.js" "$csv" $dddArg[0]
                } else {
                    node "$DIR\02_sender.js" "$csv"
                }
            }
            Write-Host ""
            Read-Host "  Pressione Enter para voltar"
        }

        "6" {
            $csv = Select-CSV
            if ($csv) {
                Write-Host ""
                $ddd    = Read-DDD
                $dddArg = Get-DddArg $ddd
                $label  = if ($ddd) { "DDD $ddd" } else { "todos os DDDs" }
                Write-Host ""
                Write-Host "  Dry-run: $([System.IO.Path]::GetFileName($csv))  [$label]" -ForegroundColor Cyan
                Write-Host ""
                if ($dddArg.Count -gt 0) {
                    node "$DIR\02_sender.js" "$csv" --dry-run $dddArg[0]
                } else {
                    node "$DIR\02_sender.js" "$csv" --dry-run
                }
            }
            Write-Host ""
            Read-Host "  Pressione Enter para voltar"
        }

        "7" {
            $csv = Select-CSV
            if ($csv) {
                Write-Host ""
                $ddd    = Read-DDD
                $dddArg = Get-DddArg $ddd
                $limite = Read-Host "  Quantos envios nesta execucao?"
                if ($limite -match "^\d+$") {
                    $label = if ($ddd) { "DDD $ddd" } else { "todos os DDDs" }
                    Write-Host ""
                    Write-Host "  Enviando ate $limite mensagens  [$label]..." -ForegroundColor Green
                    Write-Host ""
                    if ($dddArg.Count -gt 0) {
                        node "$DIR\02_sender.js" "$csv" "--limit=$limite" $dddArg[0]
                    } else {
                        node "$DIR\02_sender.js" "$csv" "--limit=$limite"
                    }
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

        default {
            Write-Host "  Opcao invalida." -ForegroundColor Red
            Write-Host ""
            Read-Host "  Pressione Enter para voltar"
        }
    }
}
