import { json, redirect, type Handle } from '@sveltejs/kit';
import { assertEncryptionKeyConfigured } from '$lib/server/crypto/credentialCrypto';
import { toPermissionSet } from '$lib/server/auth/permissions';
import { assertAuthSessionSecretConfigured, readAuthSession } from '$lib/server/auth/session';

// Global WebSocket server reference (set by custom server or vite plugin)
declare global {
	// eslint-disable-next-line no-var
	var __wss: import('ws').WebSocketServer | undefined;
}

assertEncryptionKeyConfigured();
assertAuthSessionSecretConfigured();

const ADMIN_ONLY_RULES: Array<{ pattern: RegExp; methods: Set<string> }> = [
	{ pattern: /^\/api\/resources$/, methods: new Set(['POST', 'PUT', 'DELETE']) },
	{ pattern: /^\/api\/resources\/[^/]+\/[^/]+$/, methods: new Set(['DELETE']) },
	{ pattern: /^\/api\/clusters$/, methods: new Set(['POST']) },
	{ pattern: /^\/api\/clusters\/[^/]+$/, methods: new Set(['PUT', 'DELETE']) },
	{ pattern: /^\/api\/clusters\/info$/, methods: new Set(['POST']) },
	{ pattern: /^\/api\/pods\/[^/]+\/[^/]+\/exec$/, methods: new Set(['GET']) },
	{ pattern: /^\/api\/debug$/, methods: new Set(['GET']) },
	{ pattern: /^\/api\/test$/, methods: new Set(['GET']) },
	{ pattern: /^\/api\/prometheus\/test$/, methods: new Set(['GET']) }
];

function isApiPath(pathname: string): boolean {
	return pathname.startsWith('/api/');
}

function isStaticAssetPath(pathname: string): boolean {
	if (pathname.startsWith('/_app/')) return true;
	if (pathname === '/favicon.ico' || pathname === '/robots.txt') return true;
	if (isApiPath(pathname)) return false;

	return /\.[a-zA-Z0-9]+$/.test(pathname);
}

function isPublicPath(pathname: string): boolean {
	if (pathname === '/auth' || pathname.startsWith('/auth/')) return true;
	return isStaticAssetPath(pathname);
}

function isAdminOnlyRequest(pathname: string, method: string): boolean {
	for (const rule of ADMIN_ONLY_RULES) {
		if (rule.pattern.test(pathname) && rule.methods.has(method)) {
			return true;
		}
	}

	return false;
}

export const handle: Handle = async ({ event, resolve }) => {
	const pathname = event.url.pathname;
	const method = event.request.method.toUpperCase();

	const session = readAuthSession(event);
	if (session) {
		event.locals.user = session.user;
		event.locals.isAdmin = session.isAdmin;
		event.locals.permissions = toPermissionSet(session.permissions);
	} else {
		event.locals.user = null;
		event.locals.isAdmin = false;
		event.locals.permissions = new Set();
	}

	// Handle WebSocket upgrade requests for exec endpoint
	if (pathname.match(/^\/api\/pods\/[^/]+\/[^/]+\/exec$/)) {
		const upgradeHeader = event.request.headers.get('upgrade');
		if (upgradeHeader?.toLowerCase() === 'websocket') {
			return new Response(null, {
				status: 426,
				statusText: 'Upgrade Required',
				headers: {
					'Content-Type': 'text/plain'
				}
			});
		}
	}

	if (isPublicPath(pathname)) {
		return resolve(event);
	}

	if (!event.locals.user) {
		if (isApiPath(pathname)) {
			return json({ error: 'Unauthorized', message: 'Authentication required' }, { status: 401 });
		}

		const next = `${pathname}${event.url.search}`;
		throw redirect(302, `/auth/login?next=${encodeURIComponent(next)}`);
	}

	if (isAdminOnlyRequest(pathname, method) && !event.locals.isAdmin) {
		if (isApiPath(pathname)) {
			return json(
				{ error: 'Forbidden', message: 'Administrator privileges are required.' },
				{ status: 403 }
			);
		}

		throw redirect(302, '/');
	}

	return resolve(event);
};
