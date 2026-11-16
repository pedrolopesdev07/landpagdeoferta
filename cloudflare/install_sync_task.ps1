# Run only after data/cloudflare-sync.json has been provisioned and tested.
$ErrorActionPreference = 'Stop'
$siteRoot = Split-Path -Parent $PSScriptRoot
$syncConfig = Join-Path $siteRoot 'data\cloudflare-sync.json'
if (-not (Test-Path -LiteralPath $syncConfig)) { throw 'Configure a sincronizacao antes de instalar a tarefa.' }
$pythonPath = Join-Path $siteRoot '.venv\Scripts\pythonw.exe'
$senderPath = Join-Path $siteRoot 'sync_catalog.py'
$action = New-ScheduledTaskAction -Execute $pythonPath -Argument ('"' + $senderPath + '"') -WorkingDirectory $siteRoot
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Seconds 55) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName 'LopesPromocao-CatalogSync' -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Envia somente o catalogo publico de ofertas para a landing na Cloudflare.' -Force | Out-Null
Start-ScheduledTask -TaskName 'LopesPromocao-CatalogSync'
Write-Output 'Sincronizacao instalada a cada minuto para o usuario conectado, sem armazenar senha do Windows.'
