import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ISSUER = 'https://keycloak.example.com/realms/test-realm';
const CLIENT_ID = 'sk8r-client';
const DISCOVERY_URL = `${ISSUER}/.well-known/openid-configuration`;
const JWKS_URL = `${ISSUER}/protocol/openid-connect/certs`;

const ORIGINAL_ISSUER = process.env.KEYCLOAK_ISSUER_URL;
const ORIGINAL_CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID;

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
	modulusLength: 2048
});

const publicJwk = publicKey.export({ format: 'jwk' }) as crypto.JsonWebKey & {
	kid?: string;
	use?: string;
	alg?: string;
};
publicJwk.kid = 'test-key-1';
publicJwk.use = 'sig';
publicJwk.alg = 'RS256';

function restoreEnv(): void {
	if (ORIGINAL_ISSUER === undefined) {
		delete process.env.KEYCLOAK_ISSUER_URL;
	} else {
		process.env.KEYCLOAK_ISSUER_URL = ORIGINAL_ISSUER;
	}

	if (ORIGINAL_CLIENT_ID === undefined) {
		delete process.env.KEYCLOAK_CLIENT_ID;
	} else {
		process.env.KEYCLOAK_CLIENT_ID = ORIGINAL_CLIENT_ID;
	}
}

function nowUnix(): number {
	return Math.floor(Date.now() / 1000);
}

function signJwt(payload: Record<string, unknown>): string {
	const header = {
		alg: 'RS256',
		typ: 'JWT',
		kid: publicJwk.kid
	};

	const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
	const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
	const signingInput = `${encodedHeader}.${encodedPayload}`;
	const signature = crypto
		.sign('sha256', Buffer.from(signingInput, 'utf8'), privateKey)
		.toString('base64url');

	return `${signingInput}.${signature}`;
}

function buildClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	const now = nowUnix();
	return {
		iss: ISSUER,
		aud: CLIENT_ID,
		exp: now + 300,
		iat: now - 10,
		sub: 'user-1',
		preferred_username: 'alice',
		...overrides
	};
}

function installFetchMock(): void {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: string | URL) => {
			const url = typeof input === 'string' ? input : input.toString();

			if (url === DISCOVERY_URL) {
				return new Response(
					JSON.stringify({
						issuer: ISSUER,
						authorization_endpoint: `${ISSUER}/protocol/openid-connect/auth`,
						token_endpoint: `${ISSUER}/protocol/openid-connect/token`,
						end_session_endpoint: `${ISSUER}/protocol/openid-connect/logout`,
						jwks_uri: JWKS_URL
					}),
					{ status: 200 }
				);
			}

			if (url === JWKS_URL) {
				return new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 });
			}

			throw new Error(`Unexpected fetch URL: ${url}`);
		})
	);
}

beforeEach(() => {
	process.env.KEYCLOAK_ISSUER_URL = ISSUER;
	process.env.KEYCLOAK_CLIENT_ID = CLIENT_ID;
	installFetchMock();
});

afterEach(() => {
	restoreEnv();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	vi.resetModules();
});

describe('keycloak auth helpers', () => {
	it('extracts realm roles from token claims', async () => {
		const { extractRealmRoles } = await import('./keycloak');

			expect(
				extractRealmRoles({
					realm_access: {
						roles: ['admin', 'viewer']
					}
				})
			).toEqual(['admin', 'viewer']);
			expect(extractRealmRoles(null)).toEqual([]);
			expect(extractRealmRoles({ realm_access: { roles: ['admin'] } })).toEqual(['admin']);
		});

	it('verifies JWT signatures and parses user claims', async () => {
		const { parseUserFromTokens } = await import('./keycloak');

		const idToken = signJwt(buildClaims({ nonce: 'nonce-123', name: 'Alice Admin' }));
		const accessToken = signJwt(
			buildClaims({ realm_access: { roles: ['admin'] }, preferred_username: 'alice-admin' })
		);

		const parsed = await parseUserFromTokens(
			{
				access_token: accessToken,
				id_token: idToken,
				token_type: 'Bearer',
				expires_in: 300
			},
			'nonce-123'
		);

		expect(parsed.roles).toEqual(['admin']);
		expect(parsed.user.sub).toBe('user-1');
		expect(parsed.user.username).toBe('alice');
		expect(parsed.user.name).toBe('Alice Admin');
	});

	it('falls back to id_token roles when access token has none', async () => {
		const { parseUserFromTokens } = await import('./keycloak');

		const idToken = signJwt(buildClaims({ nonce: 'nonce-abc', realm_access: { roles: ['viewer'] } }));
		const accessToken = signJwt(buildClaims({ preferred_username: 'no-access-roles' }));

		const parsed = await parseUserFromTokens(
			{
				access_token: accessToken,
				id_token: idToken,
				token_type: 'Bearer',
				expires_in: 300
			},
			'nonce-abc'
		);

		expect(parsed.roles).toEqual(['viewer']);
		expect(parsed.user.roles).toEqual(['viewer']);
	});

	it('rejects nonce mismatch', async () => {
		const { parseUserFromTokens } = await import('./keycloak');

		const idToken = signJwt(buildClaims({ nonce: 'nonce-expected' }));
		const accessToken = signJwt(buildClaims({}));

		await expect(
			parseUserFromTokens(
				{
					access_token: accessToken,
					id_token: idToken,
					token_type: 'Bearer',
					expires_in: 300
				},
				'nonce-other'
			)
		).rejects.toThrow(/Invalid nonce/);
	});

	it('rejects token with invalid signature', async () => {
		const { parseUserFromTokens } = await import('./keycloak');

		const idToken = signJwt(buildClaims({ nonce: 'nonce-123' }));
		const accessToken = signJwt(buildClaims({}));
		const [header, payload, signature] = idToken.split('.');
		const tamperIndex = Math.floor(payload.length / 2);
		const replacement = payload[tamperIndex] === 'A' ? 'B' : 'A';
		const tamperedPayload = `${payload.slice(0, tamperIndex)}${replacement}${payload.slice(
			tamperIndex + 1
		)}`;
		const tamperedIdToken = `${header}.${tamperedPayload}.${signature}`;

		await expect(
			parseUserFromTokens(
				{
					access_token: accessToken,
					id_token: tamperedIdToken,
					token_type: 'Bearer',
					expires_in: 300
				},
				'nonce-123'
			)
		).rejects.toThrow(/signature verification failed|Invalid id_token claims payload/);
	});
});
