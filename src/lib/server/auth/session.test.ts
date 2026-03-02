import crypto from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthSession } from '$lib/types/auth';

const ORIGINAL_APP_KEY = process.env.APP_ENCRYPTION_KEY;
const ORIGINAL_SESSION_KEY = process.env.AUTH_SESSION_SECRET;
const ORIGINAL_MAX_AGE = process.env.AUTH_SESSION_MAX_AGE_SECONDS;

function randomKeyBase64(): string {
	return crypto.randomBytes(32).toString('base64');
}

class MockCookies {
	private values = new Map<string, string>();

	set(name: string, value: string): void {
		this.values.set(name, value);
	}

	get(name: string): string | undefined {
		return this.values.get(name);
	}

	delete(name: string): void {
		this.values.delete(name);
	}
}

function createMockEvent() {
	return { cookies: new MockCookies() } as any;
}

function buildSessionBase(): Omit<AuthSession, 'issuedAt' | 'expiresAt'> {
	return {
		user: {
			sub: 'user-1',
			username: 'alice',
			roles: ['viewer']
		},
		permissions: ['resource:read', 'cluster:select'],
		isAdmin: false
	};
}

afterEach(() => {
	if (ORIGINAL_APP_KEY === undefined) {
		delete process.env.APP_ENCRYPTION_KEY;
	} else {
		process.env.APP_ENCRYPTION_KEY = ORIGINAL_APP_KEY;
	}

	if (ORIGINAL_SESSION_KEY === undefined) {
		delete process.env.AUTH_SESSION_SECRET;
	} else {
		process.env.AUTH_SESSION_SECRET = ORIGINAL_SESSION_KEY;
	}

	if (ORIGINAL_MAX_AGE === undefined) {
		delete process.env.AUTH_SESSION_MAX_AGE_SECONDS;
	} else {
		process.env.AUTH_SESSION_MAX_AGE_SECONDS = ORIGINAL_MAX_AGE;
	}

	vi.useRealTimers();
	vi.resetModules();
});

describe('auth session cookie', () => {
	it('encodes and decodes session round-trip', async () => {
		process.env.AUTH_SESSION_SECRET = randomKeyBase64();
		const {
			AUTH_SESSION_COOKIE_NAME,
			createSession,
			readAuthSession,
			readAuthSessionFromCookieHeader,
			setAuthSession
		} = await import('./session');

		const event = createMockEvent();
		const session = createSession(buildSessionBase());
		setAuthSession(event, session);

		const fromEvent = readAuthSession(event);
		expect(fromEvent).toBeTruthy();
		expect(fromEvent?.user.username).toBe('alice');
		expect(fromEvent?.permissions).toEqual(['resource:read', 'cluster:select']);

		const rawCookie = event.cookies.get(AUTH_SESSION_COOKIE_NAME);
		expect(rawCookie).toBeTruthy();

		const fromHeader = readAuthSessionFromCookieHeader(
			`${AUTH_SESSION_COOKIE_NAME}=${encodeURIComponent(rawCookie ?? '')}`
		);
		expect(fromHeader?.user.sub).toBe('user-1');
	});

	it('rejects expired sessions', async () => {
		process.env.AUTH_SESSION_SECRET = randomKeyBase64();
		process.env.AUTH_SESSION_MAX_AGE_SECONDS = '1';
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-03-03T00:00:00Z'));

		const { AUTH_SESSION_COOKIE_NAME, createSession, readAuthSession, setAuthSession } =
			await import('./session');
		const event = createMockEvent();

		setAuthSession(event, createSession(buildSessionBase()));
		vi.setSystemTime(new Date('2026-03-03T00:00:02Z'));

		expect(readAuthSession(event)).toBeNull();
		expect(event.cookies.get(AUTH_SESSION_COOKIE_NAME)).toBeUndefined();
	});

	it('rejects tampered session cookies', async () => {
		process.env.AUTH_SESSION_SECRET = randomKeyBase64();
		const { AUTH_SESSION_COOKIE_NAME, createSession, readAuthSession, setAuthSession } =
			await import('./session');
		const event = createMockEvent();

		setAuthSession(event, createSession(buildSessionBase()));
		const original = event.cookies.get(AUTH_SESSION_COOKIE_NAME);
		expect(original).toBeTruthy();

		const tampered = original?.slice(0, -1) + (original?.endsWith('A') ? 'B' : 'A');
		event.cookies.set(AUTH_SESSION_COOKIE_NAME, tampered ?? '');

		expect(readAuthSession(event)).toBeNull();
		expect(event.cookies.get(AUTH_SESSION_COOKIE_NAME)).toBeUndefined();
	});
});
