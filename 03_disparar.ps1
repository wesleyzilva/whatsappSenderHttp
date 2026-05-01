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
    $csvFiles = Get-ChildItem -Path "$DIR\02_disparos" -Filter "*.csv" | Sort-Object Name
    if ($csvFiles.Count -eq 0) {
        Write-Host "  Nenhum CSV encontrado em .\02_disparos\" -ForegroundColor Red
        return $null
    }
    $i = 1
    foreach ($file in $csvFiles) {
        Write-Host "  [$i] $($file.Name)"
        $i++
    }
    $sel = Read-Host "  Selecione o numero do arquivo"
    if ($sel -match "^\d+$" -and $sel -ge 1 -and $sel -le $csvFiles.Count) {
        return $csvFiles[$sel-1].FullName
    } else {
        Write-Host "  Opcao invalida." -ForegroundColor Red
        return $null
    }
}

function Show-Menu {
    Show-Banner
    Write-Host "  1. Enviar mensagens"
    Write-Host "  2. Dry-run (simulacao)"
    Write-Host "  3. Enviar com limite"
    Write-Host "  4. Ver status"
    Write-Host "  5. Resetar historico"
    Write-Host "  6. Remover runId"
    Write-Host "  7. Gerar lista de disparo"
    Write-Host "  8. Gerar listas Customer Match (Google Ads)"
    Write-Host "  9. Gerar relatorio"
    Write-Host "  0. Sair"
    Write-Host ""
}

while ($true) {
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
                    node 02_sender.js "$csv"
                }
                continue
            }
            "2" {
                Write-Host ""
                $csv = Select-CSV
                if ($csv) {
                    Write-Host ""
                    Write-Host "  Dry-run: $([System.IO.Path]::GetFileName($csv))" -ForegroundColor Cyan
                    Write-Host ""
                    node 02_sender.js "$csv" --dry-run
                }
                continue
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
                        node 02_sender.js "$csv" "--limit=$limite"
                    } else {
                        Write-Host "  Numero invalido." -ForegroundColor Red
                    }
                }
                continue
            }
            "4" {
                Write-Host ""
                node 02_sender.js --status
                Write-Host ""
                Read-Host "  Pressione Enter para voltar"
                continue
            }
            "5" {
                Write-Host ""
                Write-Host "  ATENCAO: Isso vai apagar todo o historico de envios." -ForegroundColor Red
                $confirm = Read-Host "  Confirma? (s/N)"
                if ($confirm -ieq "s") {
                    node 02_sender.js --reset
                } else {
                    Write-Host "  Cancelado." -ForegroundColor Yellow
                }
                Write-Host ""
                Read-Host "  Pressione Enter para voltar"
                continue
            }
            "6" {
                Write-Host ""
                $runId = Read-Host "  Informe o runId a remover (ex: 2026-04-08T14-30-00)"
                if (-not [string]::IsNullOrWhiteSpace($runId)) {
                    node 02_sender.js "--reset-run=$runId"
                } else {
                    Write-Host "  RunId invalido." -ForegroundColor Red
                }
                Write-Host ""
                Read-Host "  Pressione Enter para voltar"
                continue
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
                    python 01_gerar_lista.py "--campanha=$campanha" $debugArg
                } else {
                    python 01_gerar_lista.py "--campanha=$campanha"
                }
                if ($LASTEXITCODE -ne 0) {
                    Write-Host ""
                    Write-Host "  ERRO: Falha ao gerar lista de disparo" -ForegroundColor Red
                    Write-Host "  Verifique se o arquivo 01_gerar_lista.py existe" -ForegroundColor Red
                    Write-Host "  Verifique se o Python esta instalado corretamente" -ForegroundColor Red
                    Write-Host ""
                    Read-Host "  Pressione Enter para voltar"
                    continue
                }
                Write-Host ""
                Write-Host "  CSV gerado em .\02_disparos\ — selecione-o nas opcoes de envio." -ForegroundColor Green
                Write-Host ""
                Read-Host "  Pressione Enter para voltar"
                continue
            }
            "8" {
                Write-Host ""
                Write-Host "  Gerando listas para Customer Match (Google Ads)..." -ForegroundColor Magenta
                Write-Host ""
                python "04_publico/04_gerar_customer_match.py"
                if ($LASTEXITCODE -ne 0) {
                    Write-Host ""
                    Write-Host "  ERRO: Falha ao gerar listas para Customer Match" -ForegroundColor Red
                    Write-Host "  Verifique se o arquivo 04_gerar_customer_match.py existe e está correto" -ForegroundColor Red
                    Write-Host "  Verifique se o Python está instalado corretamente" -ForegroundColor Red
                } else {
                    Write-Host ""
                    Write-Host "  Listas geradas em .\04_publico\ — confira os arquivos de saída." -ForegroundColor Green
                }
                Write-Host ""
                Read-Host "  Pressione Enter para voltar"
                continue
            }
            "9" {
                Write-Host ""
                $csv = Select-CSV
                if ($csv) {
                    Write-Host ""
                    Write-Host "  Gerando relatorio para: $([System.IO.Path]::GetFileName($csv))" -ForegroundColor White
                    Write-Host ""
                    node 02_sender.js "$csv" --resumo
                } else {
                    node 02_sender.js --resumo
                }
                Write-Host ""
                Read-Host "  Pressione Enter para voltar"
                continue
            }
            "0" {
                Write-Host ""
                Write-Host "  Ate logo!" -ForegroundColor Yellow
                Write-Host ""
                return
            }
            default {
                Write-Host ""
                Write-Host "  Opcao invalida." -ForegroundColor Red
                Write-Host ""
                continue
            }
        }
    }

