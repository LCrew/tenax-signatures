import { InteractionRequiredAuthError, PublicClientApplication, type AccountInfo } from '@azure/msal-browser';

/**
 * Entra sign-in for admins in SG-Signature-Admins. The tenant/client IDs come from
 * /api/public/config at runtime (entered in the setup wizard), so the image never needs rebuilding.
 */
export interface EntraConfig {
  tenantId: string;
  clientId: string;
  scope: string;
}

let pca: PublicClientApplication | null = null;
let scope = '';

export async function initEntra(cfg: EntraConfig | null): Promise<AccountInfo | null> {
  if (!cfg) return null;
  scope = cfg.scope;
  pca = new PublicClientApplication({
    auth: {
      clientId: cfg.clientId,
      authority: `https://login.microsoftonline.com/${cfg.tenantId}`,
      redirectUri: `${window.location.origin}/`,
      postLogoutRedirectUri: `${window.location.origin}/login`,
    },
    cache: { cacheLocation: 'sessionStorage' },
  });
  await pca.initialize();
  const result = await pca.handleRedirectPromise().catch(() => null);
  if (result?.account) pca.setActiveAccount(result.account);
  const account = pca.getActiveAccount() ?? pca.getAllAccounts()[0] ?? null;
  if (account) pca.setActiveAccount(account);
  return account;
}

export function entraAccount(): AccountInfo | null {
  return pca?.getActiveAccount() ?? null;
}

export async function signInWithMicrosoft() {
  if (!pca) throw new Error('Microsoft sign-in is not configured yet');
  await pca.loginRedirect({ scopes: [scope], prompt: 'select_account' });
}

export async function signOutMicrosoft() {
  if (!pca) return;
  const account = pca.getActiveAccount();
  await pca.logoutRedirect({ account: account ?? undefined });
}

export async function getEntraToken(): Promise<string | null> {
  const account = pca?.getActiveAccount();
  if (!pca || !account) return null;
  try {
    const r = await pca.acquireTokenSilent({ scopes: [scope], account });
    return r.accessToken;
  } catch (e) {
    if (e instanceof InteractionRequiredAuthError) {
      await pca.acquireTokenRedirect({ scopes: [scope], account });
    }
    return null;
  }
}
