<#
.SYNOPSIS
    Creates or updates the "Tenax Signature API" Entra app registration for the Outlook signature service.

.DESCRIPTION
    Automates docs/entra-setup.md. Safe to re-run: it updates an existing registration found by display name.

    What it DOES (app-registration objects only):
      - single-tenant app registration "Tenax Signature API" plus its service principal
      - Application ID URI api://<PublicHost>/<appId>, delegated scopes Signature.Read (NAA / admin SPA)
        and access_as_user (legacy Office SSO fallback), v2 access tokens
      - pre-authorises the Microsoft Office client (ea5a67f6-b6f3-4338-b240-c655ddc3cc8e) for both scopes
      - SPA redirect URIs: brk-multihub://<PublicHost> (NAA), https://<PublicHost>/ and http://localhost:8085/ (admin SPA)
      - Microsoft Graph application permissions User.Read.All + GroupMember.Read.All, granted (admin consent)
      - delegated openid/profile/offline_access plus the app's own scopes, granted tenant-wide (admin consent)
      - optionally uploads a certificate public key (-CertPath, .cer/.crt/.pem)
      - looks up the SG-Signature-* security groups and prints their object IDs

    What it NEVER does:
      - create, modify or delete users or mailboxes, or write any user attribute
      - create groups, unless you pass -CreateGroups explicitly (default: off, read-only lookup)
      - add members to groups (group membership is managed by the admin)
      - create client secrets or private keys (the private key never leaves the machine that made it)

    Requirements: PowerShell 7+, Microsoft.Graph PowerShell SDK (Authentication, Applications, Groups,
    Identity.SignIns). Sign in as Global Administrator, or as Application Administrator plus Privileged Role
    Administrator for the consent grants.

.PARAMETER TenantId
    Directory (tenant) ID or verified domain, e.g. TenaxMID.onmicrosoft.com.

.PARAMETER PublicHost
    Public host name of the signature service. Default: sig.tenax.lv. Its parent domain must be a
    verified domain in the tenant, otherwise Entra rejects the api://<host>/<appId> identifier URI.

.PARAMETER CreateGroups
    Create any missing SG-Signature-* security groups (assigned membership, not mail-enabled, no members).
    Off by default.

.PARAMETER CertPath
    Optional path to the PUBLIC certificate (.cer DER, or .crt/.pem PEM) to register as a credential.
    Skipped when the app already has certificate credentials; rotate those in the portal.

.EXAMPLE
    ./scripts/entra-setup.ps1 -TenantId TenaxMID.onmicrosoft.com -CertPath ./tenax-signature-api.cer

.EXAMPLE
    ./scripts/entra-setup.ps1 -TenantId <guid> -CreateGroups
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $TenantId,
    [string] $PublicHost = 'sig.tenax.lv',
    [switch] $CreateGroups,
    [string] $CertPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$AppName        = 'Tenax Signature API'
$GraphAppId     = '00000003-0000-0000-c000-000000000000'
# "Microsoft Office" first-party client: pre-authorises Office on every platform for legacy Office SSO.
$OfficeClientId = 'ea5a67f6-b6f3-4338-b240-c655ddc3cc8e'
$GroupNames     = @('SG-Signature-Tenax', 'SG-Signature-Tenapors', 'SG-Signature-TenaxPanel', 'SG-Signature-TenaxInstall',
                    'SG-Signature-Vareno', 'SG-Signature-Pilot', 'SG-Signature-Admins')
$RedirectUris   = @("brk-multihub://$PublicHost", "https://$PublicHost/", 'http://localhost:8085/')

# --- Modules and sign-in -----------------------------------------------------------------------------------
foreach ($m in 'Microsoft.Graph.Authentication', 'Microsoft.Graph.Applications',
               'Microsoft.Graph.Groups', 'Microsoft.Graph.Identity.SignIns') {
    if (-not (Get-Module -ListAvailable -Name $m)) {
        throw "Module $m is missing. Install-Module Microsoft.Graph -Scope CurrentUser"
    }
    Import-Module $m -ErrorAction Stop
}

$scopes = @('Application.ReadWrite.All', 'AppRoleAssignment.ReadWrite.All',
            'DelegatedPermissionGrant.ReadWrite.All', 'Group.Read.All')
if ($CreateGroups) { $scopes += 'Group.ReadWrite.All' }
Connect-MgGraph -TenantId $TenantId -Scopes $scopes -NoWelcome
$tenantGuid = (Get-MgContext).TenantId

# --- Microsoft Graph permission IDs (resolved by name, not hard-coded) ------------------------------------
$graphSp = Get-MgServicePrincipal -Filter "appId eq '$GraphAppId'"
function Get-GraphRoleId([string] $value) {
    ($graphSp.AppRoles | Where-Object { $_.Value -eq $value -and $_.AllowedMemberTypes -contains 'Application' }).Id
}
function Get-GraphScopeId([string] $value) {
    ($graphSp.Oauth2PermissionScopes | Where-Object { $_.Value -eq $value }).Id
}
$appRoleIds = @{ 'User.Read.All' = Get-GraphRoleId 'User.Read.All'; 'GroupMember.Read.All' = Get-GraphRoleId 'GroupMember.Read.All' }
$graphDelegated = @('openid', 'profile', 'offline_access')

# --- App registration ---------------------------------------------------------------------------------------
$app = Get-MgApplication -Filter "displayName eq '$AppName'" -All | Select-Object -First 1
if (-not $app) {
    Write-Host "Creating app registration '$AppName'..."
    $app = New-MgApplication -DisplayName $AppName -SignInAudience 'AzureADMyOrg'
} else {
    Write-Host "Updating existing app registration '$AppName' ($($app.AppId))..."
    if ($app.SignInAudience -ne 'AzureADMyOrg') { Write-Warning "SignInAudience is '$($app.SignInAudience)'; expected AzureADMyOrg." }
}
$appId = $app.AppId

# Keep existing scope IDs stable; an enabled scope's ID can't be changed.
function Get-ScopeId([string] $value) {
    $existing = $app.Api.Oauth2PermissionScopes | Where-Object { $_.Value -eq $value }
    if ($existing) { return $existing.Id }
    return [guid]::NewGuid().ToString()
}
$sigReadId = Get-ScopeId 'Signature.Read'
$asUserId  = Get-ScopeId 'access_as_user'

$apiScopes = @(
    @{
        Id = $sigReadId; Value = 'Signature.Read'; Type = 'Admin'; IsEnabled = $true
        AdminConsentDisplayName = 'Read own email signature'
        AdminConsentDescription = 'Allows the Outlook add-in and admin UI to read the signed-in user''s rendered email signature.'
        UserConsentDisplayName  = 'Read your email signature'
        UserConsentDescription  = 'Allows the app to read your rendered company email signature.'
    },
    @{
        Id = $asUserId; Value = 'access_as_user'; Type = 'Admin'; IsEnabled = $true
        AdminConsentDisplayName = 'Access Tenax Signature API as the user (Office SSO)'
        AdminConsentDescription = 'Allows Office to call the signature API as the signed-in user (legacy Office SSO fallback).'
        UserConsentDisplayName  = 'Access Tenax Signature API as you'
        UserConsentDescription  = 'Allows Office to call the signature API as you.'
    }
)
# Keep any other scopes that already exist on the app.
$otherScopes = @($app.Api.Oauth2PermissionScopes | Where-Object { $_.Value -notin 'Signature.Read', 'access_as_user' })

# Step 1: identifier URI, scopes, token version, SPA redirects, required permissions.
# (Pre-authorisation and the self-reference to our own scopes come in step 2, once the scopes exist.)
$graphAccess = @{
    ResourceAppId  = $GraphAppId
    ResourceAccess = @(
        $appRoleIds.GetEnumerator() | ForEach-Object { @{ Id = $_.Value; Type = 'Role' } }
        $graphDelegated | ForEach-Object { @{ Id = (Get-GraphScopeId $_); Type = 'Scope' } }
    )
}
Update-MgApplication -ApplicationId $app.Id `
    -IdentifierUris @("api://$PublicHost/$appId") `
    -Api @{ RequestedAccessTokenVersion = 2; Oauth2PermissionScopes = @($otherScopes) + $apiScopes } `
    -Spa @{ RedirectUris = $RedirectUris } `
    -RequiredResourceAccess @($graphAccess)

# Step 2: pre-authorise the Office client for both scopes (legacy Office SSO without a consent prompt) and
# list the app's own scopes under API permissions so the portal shows them as granted.
$selfAccess = @{
    ResourceAppId  = $appId
    ResourceAccess = @(@{ Id = $sigReadId; Type = 'Scope' }, @{ Id = $asUserId; Type = 'Scope' })
}
Update-MgApplication -ApplicationId $app.Id -RequiredResourceAccess @($graphAccess, $selfAccess) -Api @{
    RequestedAccessTokenVersion = 2
    Oauth2PermissionScopes      = @($otherScopes) + $apiScopes
    PreAuthorizedApplications   = @(@{ AppId = $OfficeClientId; DelegatedPermissionIds = @($sigReadId, $asUserId) })
}

# --- Certificate (public key only) ----------------------------------------------------------------------------
if ($CertPath) {
    $app = Get-MgApplication -ApplicationId $app.Id
    if ($app.KeyCredentials.Count -gt 0) {
        Write-Warning "The app already has $($app.KeyCredentials.Count) certificate credential(s); skipping upload. Add or rotate certificates in the portal (Certificates & secrets)."
    } else {
        $cert = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new((Resolve-Path $CertPath).Path)
        Update-MgApplication -ApplicationId $app.Id -KeyCredentials @(@{
            Type          = 'AsymmetricX509Cert'
            Usage         = 'Verify'
            Key           = $cert.RawData
            DisplayName   = "CN=$AppName"
            StartDateTime = $cert.NotBefore.ToUniversalTime()
            EndDateTime   = $cert.NotAfter.ToUniversalTime()
        })
        Write-Host "Uploaded certificate $($cert.Thumbprint) (expires $($cert.NotAfter.ToString('yyyy-MM-dd')))."
    }
}

# --- Service principal and admin consent --------------------------------------------------------------------
$sp = Get-MgServicePrincipal -Filter "appId eq '$appId'"
if (-not $sp) {
    $sp = New-MgServicePrincipal -AppId $appId
    Start-Sleep -Seconds 5  # give replication a moment before granting consent
}

# Application permissions (admin consent = app role assignments on the Graph service principal).
$existingRoles = @(Get-MgServicePrincipalAppRoleAssignment -ServicePrincipalId $sp.Id -All |
    Where-Object { $_.ResourceId -eq $graphSp.Id } | ForEach-Object { $_.AppRoleId })
foreach ($kv in $appRoleIds.GetEnumerator()) {
    if ($existingRoles -notcontains $kv.Value) {
        New-MgServicePrincipalAppRoleAssignment -ServicePrincipalId $sp.Id -PrincipalId $sp.Id `
            -ResourceId $graphSp.Id -AppRoleId $kv.Value | Out-Null
        Write-Host "Granted application permission $($kv.Key)."
    }
}

# Delegated permissions (tenant-wide admin consent = OAuth2 permission grants, consentType AllPrincipals).
function Set-DelegatedGrant([string] $resourceSpId, [string[]] $scopeValues) {
    $scopeString = ($scopeValues -join ' ')
    $grant = Get-MgOauth2PermissionGrant -Filter "clientId eq '$($sp.Id)' and resourceId eq '$resourceSpId' and consentType eq 'AllPrincipals'" |
        Select-Object -First 1
    if ($grant) {
        $merged = (@($grant.Scope -split ' ') + $scopeValues | Where-Object { $_ } | Select-Object -Unique) -join ' '
        Update-MgOauth2PermissionGrant -OAuth2PermissionGrantId $grant.Id -Scope $merged
    } else {
        New-MgOauth2PermissionGrant -BodyParameter @{
            ClientId = $sp.Id; ConsentType = 'AllPrincipals'; ResourceId = $resourceSpId; Scope = $scopeString
        } | Out-Null
    }
}
Set-DelegatedGrant $graphSp.Id $graphDelegated
Set-DelegatedGrant $sp.Id @('Signature.Read', 'access_as_user')
Write-Host 'Admin consent granted for delegated permissions.'

# --- Security groups ------------------------------------------------------------------------------------------
$groupIds = [ordered]@{}
foreach ($name in $GroupNames) {
    $g = @(Get-MgGroup -Filter "displayName eq '$name'" -All)
    if ($g.Count -gt 1) { Write-Warning "Several groups are named '$name'; using the first. Check config manually." }
    if ($g.Count -eq 0 -and $CreateGroups) {
        $nick = ($name -replace '[^A-Za-z0-9]', '')
        $g = @(New-MgGroup -DisplayName $name -MailEnabled:$false -MailNickname $nick -SecurityEnabled `
            -Description 'Tenax signature service. Membership selects the signature company or role.')
        Write-Host "Created security group $name (no members)."
    }
    $groupIds[$name] = if ($g.Count -gt 0) { $g[0].Id } else { '<missing - create it or re-run with -CreateGroups>' }
}

# --- Summary ----------------------------------------------------------------------------------------------------
$summary = [ordered]@{
    tenantId      = $tenantGuid
    clientId      = $appId
    appIdUri      = "api://$PublicHost/$appId"
    apiScope      = "api://$PublicHost/$appId/Signature.Read"
    ssoScope      = "api://$PublicHost/$appId/access_as_user"
    redirectUris  = $RedirectUris
    groups        = $groupIds
}
Write-Host ''
Write-Host '==== Tenax Signature API: values for the setup wizard ====' -ForegroundColor Green
$summary | ConvertTo-Json -Depth 4 | Write-Host
Write-Host ''
Write-Host 'Next: upload the private key PEM in the setup wizard at https://' -NoNewline
Write-Host "$PublicHost/ and paste the IDs above. Never commit the key or these IDs to git."
