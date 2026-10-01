<#
.SYNOPSIS
    OPTIONAL: deploys the Tenax Signature Outlook add-in with Centralized Deployment PowerShell.

.DESCRIPTION
    The primary path is the Microsoft 365 admin center: Settings > Integrated apps > Upload custom apps >
    Office Add-in > upload manifest.xml > assign to SG-Signature-Pilot. Use this script only if you
    prefer PowerShell.

    Pilot (default): uploads the manifest (or updates it, if an add-in with the same manifest <Id> is
    already deployed) and assigns it ONLY to the pilot group.
    -Production:     assigns the already-deployed add-in to everyone in the organisation.

    Propagation: after upload or assignment changes, Outlook clients can take up to 24 hours to pick up
    the add-in. Restart Outlook and allow time before judging a pilot test as failed.
    Manifest updates on event-based add-ins need admin re-consent in the admin center before users get
    them. Bump {{VERSION}} on every change.

    Requirements: Windows PowerShell 5.1 (the O365CentralizedAddInDeployment module doesn't run on
    PowerShell 7), and a Global Administrator account (or another role allowed to manage integrated apps).

    Group note: -Members expects email addresses. If the pilot security group isn't mail-enabled and the
    cmdlet rejects it, assign the group in the admin center UI instead (it accepts security groups).

.PARAMETER ManifestPath
    Path or URL of the RENDERED manifest (placeholders already replaced), e.g. downloaded from the server.

.PARAMETER PilotGroup
    Pilot group's email address or name. Default: SG-Signature-Pilot.

.PARAMETER Production
    Assign to the entire organisation (AssignToEveryone). Run only after the pilot checklist is signed off.

.PARAMETER Locale
    Manifest locale. Default: en-US.

.EXAMPLE
    .\scripts\deploy-addin.ps1 -ManifestPath .\manifest.xml
.EXAMPLE
    .\scripts\deploy-addin.ps1 -ManifestPath .\manifest.xml -Production
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)] [string] $ManifestPath,
    [string] $PilotGroup = 'SG-Signature-Pilot',
    [switch] $Production,
    [string] $Locale = 'en-US'
)

$ErrorActionPreference = 'Stop'

if ($PSVersionTable.PSEdition -ne 'Desktop') {
    throw 'Run this in Windows PowerShell 5.1: O365CentralizedAddInDeployment does not support PowerShell 7.'
}
if (-not (Get-Module -ListAvailable -Name O365CentralizedAddInDeployment)) {
    throw 'Install-Module -Name O365CentralizedAddInDeployment -Scope CurrentUser'
}
Import-Module O365CentralizedAddInDeployment

# Read the add-in ID from the manifest to find an existing deployment (a URL or a local file both work).
if ($ManifestPath -match '^https?://') {
    [xml] $manifest = (Invoke-WebRequest -Uri $ManifestPath -UseBasicParsing).Content
} else {
    $ManifestPath = (Resolve-Path $ManifestPath).Path
    [xml] $manifest = Get-Content -Raw -Encoding UTF8 $ManifestPath
}
$addinId = $manifest.OfficeApp.Id
$version = $manifest.OfficeApp.Version
if ($addinId -match '\{\{' -or $version -match '\{\{') {
    throw 'The manifest still contains {{placeholders}}. Use the rendered manifest from the server, not manifest.template.xml.'
}
Write-Host "Manifest: Id=$addinId Version=$version"

Connect-OrganizationAddInService

$existing = Get-OrganizationAddIn | Where-Object { $_.ProductId -eq $addinId } | Select-Object -First 1

if ($Production) {
    if (-not $existing) { throw "Add-in $addinId is not deployed yet. Run the pilot deployment first." }
    if ($PSCmdlet.ShouldProcess($addinId, 'Assign to EVERYONE in the organisation')) {
        Set-OrganizationAddInAssignments -ProductId $existing.ProductId -AssignToEveryone $true
        Write-Host 'Assigned to everyone. Propagation can take up to 24 hours.' -ForegroundColor Yellow
    }
    return
}

if ($existing) {
    if ($PSCmdlet.ShouldProcess($addinId, "Update manifest to version $version")) {
        Set-OrganizationAddIn -ProductId $existing.ProductId -ManifestPath $ManifestPath -Locale $Locale
        Write-Host 'Manifest updated. Accept the updated permissions in the admin center if prompted.'
    }
    $productId = $existing.ProductId
} else {
    if ($PSCmdlet.ShouldProcess($addinId, 'Upload new add-in')) {
        $created = New-OrganizationAddIn -ManifestPath $ManifestPath -Locale $Locale
        $productId = $created.ProductId
        Write-Host "Uploaded. ProductId=$productId"
    }
}

# Only a fresh upload gets its assignment set here. On an update, assignments are left alone so that
# updating the manifest after the production rollout doesn't narrow it back to the pilot group.
# (To go back from everyone to pilot only: Set-OrganizationAddInAssignments -ProductId <id> -AssignToEveryone $false)
if (-not $existing -and $productId -and $PSCmdlet.ShouldProcess($PilotGroup, 'Assign add-in (pilot only)')) {
    Set-OrganizationAddInAssignments -ProductId $productId -Add -Members $PilotGroup
    Set-OrganizationAddIn -ProductId $productId -Enabled $true
    Write-Host "Assigned to $PilotGroup only. Propagation can take up to 24 hours." -ForegroundColor Yellow
}
