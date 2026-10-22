# WhatsApp Sender - Modo Continuo (supervisor)
# Mantem o disparador rodando direto: se o node cair por erro, reinicia sozinho em 30s.
# P + Enter na janela do envio = parada segura (codigo 0, o supervisor encerra).
# Uso: .\03a_continuo.ps1 [csv] [--ddd=16] [--modo=sequencial] [--chips=1,2] [--ignorar-horario]
param([Parameter(ValueFromRemainingArguments = $true)] $Resto)

$DIR = $PSScriptRoot
$Host.UI.RawUI.WindowTitle = "WhatsApp Sender - MODO CONTINUO"

# Impede o Windows de suspender o PC enquanto o modo continuo roda
Add-Type -Namespace Win -Name Power -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);' -ErrorAction SilentlyContinue
$null = [Win.Power]::SetThreadExecutionState([uint32]"0x80000001")   # ES_CONTINUOUS | ES_SYSTEM_REQUIRED

try {
    $reinicios = 0
    while ($true) {
        $args2 = @("$DIR\02_sender.js", "--continuo", "--yes") + @($Resto)
        & node @args2
        $codigo = $LASTEXITCODE
        if ($codigo -eq 0) { Write-Host "  Modo continuo encerrado." -ForegroundColor Yellow; break }
        $reinicios++
        Write-Host ""
        Write-Host "  [$(Get-Date -Format 'dd/MM HH:mm:ss')] O programa caiu (codigo $codigo). Reiniciando em 30s... (reinicio #$reinicios)" -ForegroundColor Red
        Start-Sleep -Seconds 30
    }
}
finally {
    $null = [Win.Power]::SetThreadExecutionState([uint32]"0x80000000")   # libera o PC para dormir de novo
}
