import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';

export interface EntraIdentity {
  kind: 'entra';
  oid: string;
  upn: string;
  tenantId: string;
  scopes: string[];
  /** Client app the token was issued to (azp in v2, appid in v1). */
  clientApp: string;
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly statusCode = 401,
  ) {
    super(message);
  }
}

export interface TokenValidatorOptions {
  tenantId: string;
  audiences: string[];
  /** Injected in tests; defaults to the tenant's Entra JWKS. */
  jwks?: JWTVerifyGetKey;
  requiredScope?: string;
}

const jwksCache = new Map<string, JWTVerifyGetKey>();

function tenantJwks(tenantId: string): JWTVerifyGetKey {
  let set = jwksCache.get(tenantId);
  if (!set) {
    set = createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`), {
      cooldownDuration: 60_000,
      cacheMaxAge: 12 * 60 * 60_000,
    });
    jwksCache.set(tenantId, set);
  }
  return set;
}

/**
 * Validates an Entra access token issued for this API: signature (tenant JWKS), issuer (v1 or v2
 * endpoint of OUR tenant), audience (client ID or App ID URI), expiry, and tid claim.
 * The UPN is taken only from token claims — never from request parameters.
 */
export async function validateEntraToken(token: string, opts: TokenValidatorOptions): Promise<EntraIdentity> {
  if (!opts.tenantId || opts.audiences.length === 0) throw new AuthError('Entra sign-in is not configured', 503);
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, opts.jwks ?? tenantJwks(opts.tenantId), {
      issuer: [`https://login.microsoftonline.com/${opts.tenantId}/v2.0`, `https://sts.windows.net/${opts.tenantId}/`],
      audience: opts.audiences,
      algorithms: ['RS256'],
      clockTolerance: 60,
      requiredClaims: ['exp', 'oid', 'tid'],
    }));
  } catch (e: any) {
    throw new AuthError(`Invalid token: ${e.code ?? e.message}`);
  }
  if (payload.tid !== opts.tenantId) throw new AuthError('Token is from a different tenant');
  const upn = String(payload.preferred_username ?? payload.upn ?? '').toLowerCase();
  const oid = String(payload.oid);
  if (!upn || !oid) throw new AuthError('Token is missing user claims');
  const scopes = String(payload.scp ?? '').split(' ').filter(Boolean);
  if (scopes.length === 0) throw new AuthError('App-only tokens are not accepted', 403);
  if (opts.requiredScope && !scopes.includes(opts.requiredScope)) {
    throw new AuthError(`Missing scope ${opts.requiredScope}`, 403);
  }
  const clientApp = String(payload.azp ?? payload.appid ?? '');
  return { kind: 'entra', oid, upn, tenantId: String(payload.tid), scopes, clientApp };
}
