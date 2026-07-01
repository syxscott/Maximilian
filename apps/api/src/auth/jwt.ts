import { SignJWT, jwtVerify, type JWTPayload } from "jose";

export interface AccessTokenPayload extends JWTPayload {
  sub: string;   // user id
  role: string;   // admin | operator | viewer
  tenantId?: string; // tenant id (when multi-tenant enabled)
  type: "access";
}

export interface RefreshTokenPayload extends JWTPayload {
  sub: string;   // user id
  type: "refresh";
  jti: string;   // token id for revocation
}

/**
 * Sign an access token (short-lived, 15min default).
 */
export async function signAccessToken(
  userId: string,
  role: string,
  secret: string,
  expiresIn = "15m",
  tenantId?: string,
): Promise<string> {
  const payload: AccessTokenPayload = { sub: userId, role, type: "access" };
  if (tenantId) payload.tenantId = tenantId;
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(new TextEncoder().encode(secret));
}

/**
 * Sign a refresh token (long-lived, 7d default).
 */
export async function signRefreshToken(
  userId: string,
  secret: string,
  expiresIn = "7d",
): Promise<{ token: string; jti: string }> {
  const jti = crypto.randomUUID();
  const token = await new SignJWT({ sub: userId, type: "refresh", jti } satisfies RefreshTokenPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(new TextEncoder().encode(secret));
  return { token, jti };
}

/**
 * Verify and decode an access token.
 * Throws on invalid/expired token.
 */
export async function verifyAccessToken(
  token: string,
  secret: string,
): Promise<AccessTokenPayload> {
  const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
  if ((payload as AccessTokenPayload).type !== "access") {
    throw new Error("not an access token");
  }
  return payload as AccessTokenPayload;
}

/**
 * Verify and decode a refresh token.
 * Throws on invalid/expired token.
 */
export async function verifyRefreshToken(
  token: string,
  secret: string,
): Promise<RefreshTokenPayload> {
  const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
  if ((payload as RefreshTokenPayload).type !== "refresh") {
    throw new Error("not a refresh token");
  }
  return payload as RefreshTokenPayload;
}
