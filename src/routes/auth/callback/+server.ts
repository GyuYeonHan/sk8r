import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { exchangeAuthorizationCode, parseUserFromTokens } from '$lib/server/auth/keycloak';
import {
	clearOAuthStateCookies,
	createSession,
	readOAuthStateCookies,
	setAuthSession
} from '$lib/server/auth/session';
import { isAdminRole, mapRolesToPermissions } from '$lib/server/auth/permissions';

function sanitizeNext(raw: string | null): string {
	if (!raw) return '/';
	if (!raw.startsWith('/')) return '/';
	if (raw.startsWith('//')) return '/';
	return raw;
}

export const GET: RequestHandler = async (event) => {
	const callbackState = event.url.searchParams.get('state');
	const code = event.url.searchParams.get('code');
	const oauthError = event.url.searchParams.get('error');
	const oauthErrorDescription = event.url.searchParams.get('error_description');

	const { state: expectedState, nonce, next } = readOAuthStateCookies(event);
	clearOAuthStateCookies(event.cookies);

	if (oauthError) {
		const message = oauthErrorDescription || oauthError;
		console.error('Keycloak callback returned error:', message);
		return new Response(`Authentication failed: ${message}`, { status: 401 });
	}

	if (!callbackState || !expectedState || callbackState !== expectedState) {
		return new Response('Invalid authentication state.', { status: 400 });
	}

	if (!code) {
		return new Response('Missing authorization code.', { status: 400 });
	}

	try {
		const tokens = await exchangeAuthorizationCode(event, code);
		const { user, roles, idToken } = await parseUserFromTokens(tokens, nonce);
		const permissions = mapRolesToPermissions(roles);
		const isAdmin = isAdminRole(roles);

		const session = createSession({
			user: {
				...user,
				roles
			},
			permissions,
			isAdmin,
			idToken
		});

		setAuthSession(event, session);
		throw redirect(302, sanitizeNext(next));
	} catch (error) {
		console.error('Failed to complete Keycloak callback:', error);
		return new Response('Failed to complete authentication.', { status: 500 });
	}
};
