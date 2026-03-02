import crypto from 'node:crypto';
import type { Cookies, RequestEvent } from '@sveltejs/kit';
import type { AuthSession } from '$lib/types/auth';

const KEY_BYTES = 32;
const IV_BYTES = 12;

export const AUTH_SESSION_COOKIE_NAME = 'sk8r_auth_session';
export const AUTH_STATE_COOKIE_NAME = 'sk8r_auth_state';
export const AUTH_NONCE_COOKIE_NAME = 'sk8r_auth_nonce';
export const AUTH_NEXT_COOKIE_NAME = 'sk8r_auth_next';

const TRANSIENT_COOKIE_MAX_AGE = 60 * 10; // 10 minutes

let cachedSessionKey: Buffer | null = null;

function readSessionSecret(): Buffer {
	if (cachedSessionKey) return cachedSessionKey;

	const raw = process.env.AUTH_SESSION_SECRET || process.env.APP_ENCRYPTION_KEY;
	if (!raw) {
		throw new Error(
			'AUTH_SESSION_SECRET (or APP_ENCRYPTION_KEY fallback) is required for auth sessions.'
		);
	}

	let decoded: Buffer;
	try {
		decoded = Buffer.from(raw, 'base64');
	} catch {
		throw new Error('AUTH_SESSION_SECRET must be valid base64.');
	}

	if (decoded.length !== KEY_BYTES) {
		throw new Error('AUTH_SESSION_SECRET must decode to exactly 32 bytes.');
	}

	cachedSessionKey = decoded;
	return decoded;
}

export function assertAuthSessionSecretConfigured(): void {
	readSessionSecret();
}

function getSessionMaxAgeSeconds(): number {
	const raw = process.env.AUTH_SESSION_MAX_AGE_SECONDS;
	if (!raw) return 60 * 60 * 8; // 8 hours

	const parsed = Number.parseInt(raw, 10);
	if (Number.isNaN(parsed) || parsed <= 0) {
		return 60 * 60 * 8;
	}

	return parsed;
}

function getCookieOptions(maxAge: number) {
	return {
		path: '/',
		httpOnly: true,
		sameSite: 'lax' as const,
		secure: process.env.NODE_ENV === 'production',
		maxAge
	};
}

function encodeSession(session: AuthSession): string {
	const key = readSessionSecret();
	const iv = crypto.randomBytes(IV_BYTES);
	const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

	const plaintext = Buffer.from(JSON.stringify(session), 'utf8');
	const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
	const tag = cipher.getAuthTag();

	const payload = {
		iv: iv.toString('base64'),
		tag: tag.toString('base64'),
		ciphertext: ciphertext.toString('base64')
	};

	return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeSession(value: string): AuthSession | null {
	const key = readSessionSecret();

	try {
		const serializedPayload = Buffer.from(value, 'base64url').toString('utf8');
		const payload = JSON.parse(serializedPayload) as {
			iv?: string;
			tag?: string;
			ciphertext?: string;
		};

		if (!payload.iv || !payload.tag || !payload.ciphertext) {
			return null;
		}

		const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64'));
		decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));

		const decrypted = Buffer.concat([
			decipher.update(Buffer.from(payload.ciphertext, 'base64')),
			decipher.final()
		]);
		const session = JSON.parse(decrypted.toString('utf8')) as AuthSession;

		if (
			!session ||
			typeof session !== 'object' ||
			!session.user ||
			typeof session.expiresAt !== 'number' ||
			!Array.isArray(session.permissions)
		) {
			return null;
		}

		return session;
	} catch {
		return null;
	}
}

export function isSessionExpired(session: AuthSession): boolean {
	const now = Math.floor(Date.now() / 1000);
	return session.expiresAt <= now;
}

export function createSession(data: Omit<AuthSession, 'issuedAt' | 'expiresAt'>): AuthSession {
	const issuedAt = Math.floor(Date.now() / 1000);
	const expiresAt = issuedAt + getSessionMaxAgeSeconds();

	return {
		...data,
		issuedAt,
		expiresAt
	};
}

export function setAuthSession(event: RequestEvent, session: AuthSession): void {
	const encoded = encodeSession(session);
	const maxAge = Math.max(0, session.expiresAt - Math.floor(Date.now() / 1000));
	event.cookies.set(AUTH_SESSION_COOKIE_NAME, encoded, getCookieOptions(maxAge));
}

export function clearAuthSession(event: RequestEvent): void {
	event.cookies.delete(AUTH_SESSION_COOKIE_NAME, { path: '/' });
}

export function readAuthSession(event: RequestEvent): AuthSession | null {
	const raw = event.cookies.get(AUTH_SESSION_COOKIE_NAME);
	if (!raw) return null;

	const session = decodeSession(raw);
	if (!session || isSessionExpired(session)) {
		clearAuthSession(event);
		return null;
	}

	return session;
}

function readCookieValueFromHeader(
	cookieHeader: string | null | undefined,
	name: string
): string | null {
	if (!cookieHeader) return null;

	for (const part of cookieHeader.split(';')) {
		const trimmed = part.trim();
		if (!trimmed.startsWith(`${name}=`)) continue;
		return decodeURIComponent(trimmed.slice(name.length + 1));
	}

	return null;
}

export function readAuthSessionFromCookieHeader(
	cookieHeader: string | null | undefined
): AuthSession | null {
	const value = readCookieValueFromHeader(cookieHeader, AUTH_SESSION_COOKIE_NAME);
	if (!value) return null;

	const session = decodeSession(value);
	if (!session || isSessionExpired(session)) {
		return null;
	}

	return session;
}

export function setOAuthStateCookies(
	event: RequestEvent,
	options: { state: string; nonce: string; next: string }
): void {
	const cookieOptions = getCookieOptions(TRANSIENT_COOKIE_MAX_AGE);
	event.cookies.set(AUTH_STATE_COOKIE_NAME, options.state, cookieOptions);
	event.cookies.set(AUTH_NONCE_COOKIE_NAME, options.nonce, cookieOptions);
	event.cookies.set(AUTH_NEXT_COOKIE_NAME, options.next, cookieOptions);
}

export function clearOAuthStateCookies(cookies: Cookies): void {
	cookies.delete(AUTH_STATE_COOKIE_NAME, { path: '/' });
	cookies.delete(AUTH_NONCE_COOKIE_NAME, { path: '/' });
	cookies.delete(AUTH_NEXT_COOKIE_NAME, { path: '/' });
}

export function readOAuthStateCookies(event: RequestEvent): {
	state: string | null;
	nonce: string | null;
	next: string | null;
} {
	return {
		state: event.cookies.get(AUTH_STATE_COOKIE_NAME) ?? null,
		nonce: event.cookies.get(AUTH_NONCE_COOKIE_NAME) ?? null,
		next: event.cookies.get(AUTH_NEXT_COOKIE_NAME) ?? null
	};
}
