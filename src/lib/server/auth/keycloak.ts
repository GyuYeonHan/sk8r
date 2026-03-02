import crypto from 'node:crypto';
import type { RequestEvent } from '@sveltejs/kit';
import type { AuthUser } from '$lib/types/auth';

interface OpenIdConfiguration {
	issuer: string;
	authorization_endpoint: string;
	token_endpoint: string;
	jwks_uri: string;
	userinfo_endpoint?: string;
	end_session_endpoint?: string;
}

interface TokenResponse {
	access_token: string;
	id_token?: string;
	token_type: string;
	expires_in: number;
	scope?: string;
	refresh_token?: string;
}

interface TokenClaims {
	iss?: string;
	aud?: string | string[];
	azp?: string;
	exp?: number;
	iat?: number;
	nbf?: number;
	sub?: string;
	preferred_username?: string;
	email?: string;
	name?: string;
	nonce?: string;
	realm_access?: {
		roles?: string[];
	};
}

interface JwtHeader {
	alg?: string;
	kid?: string;
	typ?: string;
}

type JsonWebKeyWithMeta = crypto.JsonWebKey & {
	kid?: string;
	alg?: string;
	use?: string;
	key_ops?: string[];
	x5c?: string[];
};

interface JsonWebKeySetResponse {
	keys?: JsonWebKeyWithMeta[];
}

interface ParsedJwt {
	header: JwtHeader;
	claims: TokenClaims;
	signingInput: string;
	signature: Buffer;
}

const DISCOVERY_CACHE_TTL_MS = 5 * 60 * 1000;
const JWKS_CACHE_TTL_MS = 5 * 60 * 1000;
const TOKEN_TIME_SKEW_SECONDS = 60;

const JWT_HASH_BY_ALG: Record<string, string> = {
	RS256: 'sha256',
	RS384: 'sha384',
	RS512: 'sha512',
	PS256: 'sha256',
	PS384: 'sha384',
	PS512: 'sha512'
};

let discoveryCache: { config: OpenIdConfiguration; expiresAt: number } | null = null;
let jwksCache: { uri: string; keys: JsonWebKeyWithMeta[]; expiresAt: number } | null = null;

function getRequiredEnv(name: string): string {
	const value = process.env[name]?.trim();
	if (!value) {
		throw new Error(`${name} is required for Keycloak authentication.`);
	}

	return value;
}

export function resolveAppBaseUrl(event: RequestEvent): string {
	const configured = process.env.APP_BASE_URL?.trim();
	if (configured) {
		return configured.replace(/\/+$/, '');
	}

	return event.url.origin;
}

export function getCallbackUrl(event: RequestEvent): string {
	return `${resolveAppBaseUrl(event)}/auth/callback`;
}

function getIssuerUrl(): string {
	return getRequiredEnv('KEYCLOAK_ISSUER_URL').replace(/\/+$/, '');
}

function normalizeIssuer(value: string): string {
	return value.replace(/\/+$/, '');
}

function parseJsonBase64Url<T>(segment: string, label: string): T {
	try {
		return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as T;
	} catch {
		throw new Error(`Invalid ${label} payload.`);
	}
}

function parseJwt(token: string, tokenName: string): ParsedJwt {
	const parts = token.split('.');
	if (parts.length !== 3) {
		throw new Error(`Invalid ${tokenName} format.`);
	}

	const [headerPart, claimsPart, signaturePart] = parts;
	if (!headerPart || !claimsPart || !signaturePart) {
		throw new Error(`Invalid ${tokenName} format.`);
	}

	const header = parseJsonBase64Url<JwtHeader>(headerPart, `${tokenName} header`);
	const claims = parseJsonBase64Url<TokenClaims>(claimsPart, `${tokenName} claims`);
	const signature = Buffer.from(signaturePart, 'base64url');

	return {
		header,
		claims,
		signingInput: `${headerPart}.${claimsPart}`,
		signature
	};
}

function wrapPem64(value: string): string {
	return value.match(/.{1,64}/g)?.join('\n') ?? value;
}

function getPublicKeyFromJwk(jwk: JsonWebKeyWithMeta): crypto.KeyObject {
	if (Array.isArray(jwk.x5c) && jwk.x5c.length > 0) {
		const certificatePem = `-----BEGIN CERTIFICATE-----\n${wrapPem64(jwk.x5c[0])}\n-----END CERTIFICATE-----`;
		return crypto.createPublicKey(certificatePem);
	}

	return crypto.createPublicKey({ key: jwk as crypto.JsonWebKey, format: 'jwk' });
}

function verifyJwtSignature(
	tokenName: string,
	parsed: ParsedJwt,
	jwk: JsonWebKeyWithMeta
): void {
	const alg = parsed.header.alg;
	if (!alg || alg === 'none') {
		throw new Error(`${tokenName} has an invalid signing algorithm.`);
	}

	const hashAlgorithm = JWT_HASH_BY_ALG[alg];
	if (!hashAlgorithm) {
		throw new Error(`${tokenName} signing algorithm ${alg} is not supported.`);
	}

	if (jwk.use && jwk.use !== 'sig') {
		throw new Error(`${tokenName} key use is invalid for signature verification.`);
	}
	if (Array.isArray(jwk.key_ops) && !jwk.key_ops.includes('verify')) {
		throw new Error(`${tokenName} key does not allow signature verification.`);
	}
	if (jwk.alg && jwk.alg !== alg) {
		throw new Error(`${tokenName} key algorithm does not match token algorithm.`);
	}

	const publicKey = getPublicKeyFromJwk(jwk);
	const signingInput = Buffer.from(parsed.signingInput, 'utf8');

	const isValid = alg.startsWith('PS')
		? crypto.verify(
				hashAlgorithm,
				signingInput,
				{
					key: publicKey,
					padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
					saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST
				},
				parsed.signature
			)
		: crypto.verify(hashAlgorithm, signingInput, publicKey, parsed.signature);

	if (!isValid) {
		throw new Error(`${tokenName} signature verification failed.`);
	}
}

function normalizeAudience(audience: TokenClaims['aud']): string[] {
	if (!audience) return [];
	return Array.isArray(audience) ? audience : [audience];
}

function validateStandardClaims(
	tokenName: string,
	claims: TokenClaims,
	discovery: OpenIdConfiguration,
	clientId: string
): void {
	const issuer = claims.iss ? normalizeIssuer(claims.iss) : '';
	const expectedIssuer = normalizeIssuer(discovery.issuer);
	if (!issuer || issuer !== expectedIssuer) {
		throw new Error(`${tokenName} issuer claim is invalid.`);
	}

	const audiences = normalizeAudience(claims.aud);
	const audienceMatches = audiences.includes(clientId) || claims.azp === clientId;
	if (!audienceMatches) {
		throw new Error(`${tokenName} audience claim is invalid.`);
	}

	if (typeof claims.exp !== 'number') {
		throw new Error(`${tokenName} is missing exp claim.`);
	}

	const now = Math.floor(Date.now() / 1000);
	if (claims.exp <= now - TOKEN_TIME_SKEW_SECONDS) {
		throw new Error(`${tokenName} has expired.`);
	}

	if (typeof claims.nbf === 'number' && claims.nbf > now + TOKEN_TIME_SKEW_SECONDS) {
		throw new Error(`${tokenName} is not valid yet.`);
	}

	if (typeof claims.iat === 'number' && claims.iat > now + TOKEN_TIME_SKEW_SECONDS) {
		throw new Error(`${tokenName} issued-at claim is invalid.`);
	}
}

export function extractRealmRoles(claims: TokenClaims | null): string[] {
	if (!claims?.realm_access?.roles || !Array.isArray(claims.realm_access.roles)) {
		return [];
	}

	return claims.realm_access.roles.filter((role): role is string => typeof role === 'string');
}

export function buildRandomValue(bytes = 32): string {
	return crypto.randomBytes(bytes).toString('base64url');
}

async function discoverOpenIdConfiguration(): Promise<OpenIdConfiguration> {
	const now = Date.now();
	if (discoveryCache && discoveryCache.expiresAt > now) {
		return discoveryCache.config;
	}

	const issuer = getIssuerUrl();
	const normalized = issuer.endsWith('/') ? issuer : `${issuer}/`;
	const discoveryUrl = new URL('.well-known/openid-configuration', normalized);

	const response = await fetch(discoveryUrl.toString());
	if (!response.ok) {
		throw new Error(
			`Failed to discover Keycloak OpenID config: ${response.status} ${response.statusText}`
		);
	}

	const config = (await response.json()) as OpenIdConfiguration;
	if (!config.jwks_uri) {
		throw new Error('Keycloak discovery response is missing jwks_uri.');
	}

	discoveryCache = {
		config,
		expiresAt: now + DISCOVERY_CACHE_TTL_MS
	};

	return config;
}

async function fetchJwks(discovery: OpenIdConfiguration): Promise<JsonWebKeyWithMeta[]> {
	const now = Date.now();
	if (
		jwksCache &&
		jwksCache.uri === discovery.jwks_uri &&
		jwksCache.expiresAt > now &&
		jwksCache.keys.length > 0
	) {
		return jwksCache.keys;
	}

	const response = await fetch(discovery.jwks_uri);
	if (!response.ok) {
		throw new Error(`Failed to load JWKS: ${response.status} ${response.statusText}`);
	}

	const jwks = (await response.json()) as JsonWebKeySetResponse;
	const keys = Array.isArray(jwks.keys)
		? jwks.keys.filter((key): key is JsonWebKeyWithMeta => typeof key === 'object' && key !== null)
		: [];

	if (keys.length === 0) {
		throw new Error('No keys found in JWKS response.');
	}

	jwksCache = {
		uri: discovery.jwks_uri,
		keys,
		expiresAt: now + JWKS_CACHE_TTL_MS
	};

	return keys;
}

function selectVerificationKey(
	tokenName: string,
	keys: JsonWebKeyWithMeta[],
	kid: string | undefined
): JsonWebKeyWithMeta {
	if (kid) {
		const match = keys.find((key) => key.kid === kid);
		if (!match) {
			throw new Error(`${tokenName} key id not found in JWKS.`);
		}
		return match;
	}

	if (keys.length === 1) {
		return keys[0];
	}

	throw new Error(`${tokenName} is missing kid header and JWKS has multiple keys.`);
}

async function verifyAndDecodeToken(
	tokenName: string,
	token: string | undefined,
	discovery: OpenIdConfiguration,
	clientId: string,
	required: boolean
): Promise<TokenClaims | null> {
	if (!token) {
		if (required) {
			throw new Error(`Missing ${tokenName} in token response.`);
		}
		return null;
	}

	const parsed = parseJwt(token, tokenName);
	const keys = await fetchJwks(discovery);
	const verificationKey = selectVerificationKey(tokenName, keys, parsed.header.kid);
	verifyJwtSignature(tokenName, parsed, verificationKey);
	validateStandardClaims(tokenName, parsed.claims, discovery, clientId);

	return parsed.claims;
}

export async function buildAuthorizationUrl(
	event: RequestEvent,
	options: { state: string; nonce: string }
): Promise<string> {
	const discovery = await discoverOpenIdConfiguration();
	const clientId = getRequiredEnv('KEYCLOAK_CLIENT_ID');
	const callbackUrl = getCallbackUrl(event);

	const authorizeUrl = new URL(discovery.authorization_endpoint);
	authorizeUrl.searchParams.set('client_id', clientId);
	authorizeUrl.searchParams.set('response_type', 'code');
	authorizeUrl.searchParams.set('scope', 'openid profile email');
	authorizeUrl.searchParams.set('redirect_uri', callbackUrl);
	authorizeUrl.searchParams.set('state', options.state);
	authorizeUrl.searchParams.set('nonce', options.nonce);

	return authorizeUrl.toString();
}

export async function exchangeAuthorizationCode(
	event: RequestEvent,
	code: string
): Promise<TokenResponse> {
	const discovery = await discoverOpenIdConfiguration();
	const clientId = getRequiredEnv('KEYCLOAK_CLIENT_ID');
	const clientSecret = getRequiredEnv('KEYCLOAK_CLIENT_SECRET');
	const callbackUrl = getCallbackUrl(event);

	const response = await fetch(discovery.token_endpoint, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded'
		},
		body: new URLSearchParams({
			grant_type: 'authorization_code',
			code,
			redirect_uri: callbackUrl,
			client_id: clientId,
			client_secret: clientSecret
		})
	});

	if (!response.ok) {
		const body = await response.text();
		throw new Error(`Failed to exchange authorization code: ${response.status} ${body}`);
	}

	return (await response.json()) as TokenResponse;
}

export async function parseUserFromTokens(
	tokens: TokenResponse,
	expectedNonce: string | null
): Promise<{ user: AuthUser; roles: string[]; idToken?: string }> {
	const discovery = await discoverOpenIdConfiguration();
	const clientId = getRequiredEnv('KEYCLOAK_CLIENT_ID');

	const idClaims = await verifyAndDecodeToken('id_token', tokens.id_token, discovery, clientId, true);
	const accessClaims = await verifyAndDecodeToken(
		'access_token',
		tokens.access_token,
		discovery,
		clientId,
		true
	);

	if (expectedNonce && idClaims?.nonce !== expectedNonce) {
		throw new Error('Invalid nonce in Keycloak callback.');
	}

	const claims = idClaims || accessClaims;
	if (!claims?.sub) {
		throw new Error('Missing subject claim in token payload.');
	}

	let roles = extractRealmRoles(accessClaims);
	if (roles.length === 0) {
		roles = extractRealmRoles(idClaims);
	}

	const username = claims.preferred_username || claims.email || claims.name || claims.sub;

	const user: AuthUser = {
		sub: claims.sub,
		username,
		email: claims.email,
		name: claims.name,
		roles
	};

	return {
		user,
		roles,
		idToken: tokens.id_token
	};
}

export async function buildLogoutUrl(event: RequestEvent, idTokenHint?: string): Promise<string> {
	const discovery = await discoverOpenIdConfiguration();
	if (!discovery.end_session_endpoint) {
		return `${resolveAppBaseUrl(event)}/auth/login`;
	}

	const clientId = getRequiredEnv('KEYCLOAK_CLIENT_ID');
	const logoutUrl = new URL(discovery.end_session_endpoint);
	logoutUrl.searchParams.set('client_id', clientId);
	logoutUrl.searchParams.set('post_logout_redirect_uri', `${resolveAppBaseUrl(event)}/auth/login`);
	if (idTokenHint) {
		logoutUrl.searchParams.set('id_token_hint', idTokenHint);
	}

	return logoutUrl.toString();
}
