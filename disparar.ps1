# WhatsApp Sender - Menu de Controle
# Dra. Daiana Ferraz - Responsavel: Wesley Silva

$Host.UI.RawUI.WindowTitle = "WhatsApp Sender - Dra. Daiana Ferraz"
$DIR = $PSScriptRoot

function Show-Banner {
    Write-Host ""
    Write-Host "==========================================" -ForegroundColor Yellow
    Write-Host "  WhatsApp Sender - Dra. Daiana Ferraz   " -ForegroundColor Yellow
    Write-Host "==========================================" -ForegroundColor Yellow
    Write-Host ""
}

function Select-CSV {
    $csvFiles = Get-ChildItem -Path "$DIR\disparos" -Filter "*.csv" | Sort-Object Name
    if ($csvFiles.Count -eq 0) {
        Write-Host "  Nenhum CSV encontrado em .\disparos\" -ForegroundColor Red
        return $null
    }
    Write-Host "  CSVs disponiveis:" -ForegroundColor Cyan
    for ($i = 0; $i -lt $csvFiles.Count; $i++) {
        Write-Host "    [$($i+1)] $($csvFiles[$i].Name)"
    }
    Write-Host ""
    $choice = Read-Host "  Escolha o numero do CSV (Enter = mais recente)"
    if ([string]::IsNullOrWhiteSpace($choice)) {
        return $csvFiles[-1].FullName
    }
    $idx = [int]$choice - 1
    if ($idx -ge 0 -and $idx -lt $csvFiles.Count) {
        return $csvFiles[$idx].FullName
    }
    Write-Host "  Opcao invalida. Usando o mais recente." -ForegroundColor Yellow
    return $csvFiles[-1].FullName
}

function Show-Menu {
    Show-Banner
    Write-Host "  Selecione uma opcao:" -ForegroundColor White
    Write-Host ""
    Write-Host "  [1]  Enviar mensagens        (ate 100/dia, cadencia humana, janela horario)" -ForegroundColor Green
    Write-Host "  [2]  Dry-run (simulacao)     (nao envia, so mostra o que faria)" -ForegroundColor Cyan
    Write-Host "  [3]  Envio com limite        (define exatamente quantos nesta execucao)" -ForegroundColor Green
    Write-Host "  [4]  Status do log           (resumo de tudo que ja foi enviado)" -ForegroundColor Yellow
    Write-Host "  [5]  Limpar log completo     (reset de sent_log.json)" -ForegroundColor Red
    Write-Host "  [6]  Limpar run especifico   (remove uma execucao do log)" -ForegroundColor Red
    Write-Host "  [7]  Regerar mensagens       (roda gerar_disparos.py e gera novo CSV)" -ForegroundColor Magenta
    Write-Host "  [0]  Sair"
    Write-Host ""
}

Set-Location $DIR

if (-not (Test-Path "$DIR\node_modules")) {
    Write-Host "  Instalando dependencias (npm install)..." -ForegroundColor Yellow
    npm install
    Write-Host ""
}

do {
    Show-Menu
    $op = Read-Host "  Opcao"

    switch ($op) {

        "1" {
            Write-Host ""
            $csv = Select-CSV
            if ($csv) {
                Write-Host ""
                Write-Host "  Iniciando envio: $([System.IO.Path]::GetFileName($csv))" -ForegroundColor Green
                Write-Host ""
                node sender.js "$csv"
            }
        }

        "2" {
            Write-Host ""
            $csv = Select-CSV
            if ($csv) {
                Write-Host ""
                Write-Host "  Dry-run: $([System.IO.Path]::GetFileName($csv))" -ForegroundColor Cyan
                Write-Host ""
                node sender.js "$csv" --dry-run
            }
        }

        "3" {
            Write-Host ""
            $csv = Select-CSV
            if ($csv) {
                $limite = Read-Host "  Quantos envios nesta execucao?"
                if ($limite -match "^\d+$") {
                    Write-Host ""
                    Write-Host "  Enviando ate $limite mensagens..." -ForegroundColor Green
                    Write-Host ""
                    node sender.js "$csv" "--limit=$limite"
                } else {
                    Write-Host "  Numero invalido." -ForegroundColor Red
                }
            }
        }

        "4" {
            Write-Host ""
            node sender.js --status
            Write-Host ""
            Read-Host "  Pressione Enter para voltar"
        }

        "5" {
            Write-Host ""
            Write-Host "  ATENCAO: Isso vai apagar todo o historico de envios." -ForegroundColor Red
            $confirm = Read-Host "  Confirma? (s/N)"
            if ($confirm -ieq "s") {
                node sender.js --reset
            } else {
                Write-Host "  Cancelado." -ForegroundColor Yellow
            }
            Write-Host ""
            Read-Host "  Pressione Enter para voltar"
        }

        "6" {
            Write-Host ""
            $runId = Read-Host "  Informe o runId a remover (ex: 2026-04-08T14-30-00)"
            if (-not [string]::IsNullOrWhiteSpace($runId)) {
                node sender.js "--reset-run=$runId"
            } else {
                Write-Host "  RunId invalido." -ForegroundColor Red
            }
            Write-Host ""
            Read-Host "  Pressione Enter para voltar"
        }

        "7" {
            Write-Host ""
            Write-Host "  Campanhas disponiveis: A, B, C, ... ou TODAS" -ForegroundColor Cyan
            $campanha = Read-Host "  Campanha (Enter = A)"
            if ([string]::IsNullOrWhiteSpace($campanha)) { $campanha = "A" }
            $debugFlag = Read-Host "  Ativar debug? (s/N)"
            $debugArg = if ($debugFlag -ieq "s") { "--debug" } else { "" }
            Write-Host ""
            Write-Host "  Gerando CSV para campanha '$($campanha.ToUpper())'..." -ForegroundColor Magenta
            Write-Host ""
            if ($debugArg) {
                python gerar_disparos.py "--campanha=$campanha" $debugArg
            } else {
                python gerar_disparos.py "--campanha=$campanha"
            }
            Write-Host ""
            Write-Host "  CSV gerado em .\disparos\ — selecione-o nas opcoes de envio." -ForegroundColor Green
            Write-Host ""
            Read-Host "  Pressione Enter para voltar"
        }

        "0" {
            Write-Host ""
            Write-Host "  Ate logo!" -ForegroundColor Yellow
            Write-Host ""
        }

        default {
            Write-Host ""
            Write-Host "  Opcao invalida." -ForegroundColor Red
            Write-Host ""
        }
    }

} while ($op -ne "0")