import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { buildLogoutUrl } from '$lib/server/auth/keycloak';
import {
	clearAuthSession,
	clearOAuthStateCookies,
	readAuthSession
} from '$lib/server/auth/session';

async function performLogout(event: Parameters<RequestHandler>[0]): Promise<never> {
	const session = readAuthSession(event);
	clearAuthSession(event);
	clearOAuthStateCookies(event.cookies);

	try {
		const logoutUrl = await buildLogoutUrl(event, session?.idToken);
		throw redirect(302, logoutUrl);
	} catch (error) {
		console.error('Failed to build Keycloak logout URL:', error);
		throw redirect(302, '/auth/login');
	}
}

export const GET: RequestHandler = async (event) => {
	return performLogout(event);
};

export const POST: RequestHandler = async (event) => {
	return performLogout(event);
};
