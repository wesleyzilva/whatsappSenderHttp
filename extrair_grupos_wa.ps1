# Extrai e deduplica números de telefone de dumps de membros de grupos WhatsApp
# (formato copiado do WhatsApp Web: "Nome, +55 46 9XXXX-XXXX, ..., Você").
#
# Convenções herdadas de 01_gerar_lista.py:
#   - limpar-fone: mantém apenas dígitos; remove o 55 do país
#   - fone válido: celular BR com 11 dígitos (DDD+9+XXXXXXXX) ou
#     legado com 10 dígitos onde o 3º dígito é 6-9
#
# Saída (02_disparos/):
#   - <nome>_dedup_<data>.txt       — um número por linha (sem +55), ordenado
#   - <nome>_excluidos_<data>.txt   — estrangeiros/inválidos, para revisão
#
# Uso:
#   powershell -File extrair_grupos_wa.ps1 01_fontes/patoBranco.txt

param(
    [string]$Entrada = "01_fontes\patoBranco.txt"
)

$BASE_DIR  = $PSScriptRoot
$SAIDA_DIR = Join-Path $BASE_DIR "02_disparos"

if (-not [System.IO.Path]::IsPathRooted($Entrada)) {
    $Entrada = Join-Path $BASE_DIR $Entrada
}
if (-not (Test-Path $Entrada)) {
    Write-Error "Arquivo não encontrado: $Entrada"
    exit 1
}

$texto = Get-Content $Entrada -Raw -Encoding UTF8

# Captura números no formato internacional: +55 46 9133-1030, +44 7927 096877,
# +62 857-0086-1099, +54 9 3814 04-8278, etc.
$reFone = [regex]'\+\d{1,3}(?:[\s\-]\d+)+'
$brutos = $reFone.Matches($texto) | ForEach-Object { $_.Value }

$validos   = @{}
$excluidos = @{}

foreach ($bruto in $brutos) {
    $digitos = $bruto -replace '\D', ''
    $limpo   = $digitos
    if ($limpo.StartsWith('55')) { $limpo = $limpo.Substring(2) }

    $ok = ($limpo.Length -eq 11) -or
          ($limpo.Length -eq 10 -and '6789'.Contains($limpo[2]))

    if ($ok) { $validos[$limpo]   = $true }
    else     { $excluidos[$digitos] = $true }
}

$listaValidos   = $validos.Keys   | Sort-Object
$listaExcluidos = $excluidos.Keys | Sort-Object

$hoje = Get-Date -Format 'yyyyMMdd'
$nome = [System.IO.Path]::GetFileNameWithoutExtension($Entrada)
New-Item -ItemType Directory -Force -Path $SAIDA_DIR | Out-Null

$arqValidos   = Join-Path $SAIDA_DIR "${nome}_dedup_${hoje}.txt"
$arqExcluidos = Join-Path $SAIDA_DIR "${nome}_excluidos_${hoje}.txt"

[System.IO.File]::WriteAllLines($arqValidos,   [string[]]$listaValidos)
[System.IO.File]::WriteAllLines($arqExcluidos, [string[]]$listaExcluidos)

$ddds = @{}
foreach ($f in $listaValidos) {
    $ddd = $f.Substring(0, 2)
    $ddds[$ddd] = [int]($ddds[$ddd]) + 1
}

Write-Output "Fonte:              $([System.IO.Path]::GetFileName($Entrada))"
Write-Output "Ocorrências brutas: $($brutos.Count)"
Write-Output "Únicos válidos BR:  $($listaValidos.Count)  -> $arqValidos"
Write-Output "Excluídos (estrangeiros/inválidos): $($listaExcluidos.Count)  -> $arqExcluidos"
Write-Output "Duplicatas removidas: $($brutos.Count - $listaValidos.Count - $listaExcluidos.Count)"
Write-Output ""
Write-Output "Distribuição por DDD:"
foreach ($ddd in ($ddds.Keys | Sort-Object)) {
    Write-Output "  DDD ${ddd}: $($ddds[$ddd])"
}
