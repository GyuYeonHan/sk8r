import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { buildAuthorizationUrl, buildRandomValue } from '$lib/server/auth/keycloak';
import { setOAuthStateCookies } from '$lib/server/auth/session';

function sanitizeNext(raw: string | null): string {
	if (!raw) return '/';
	if (!raw.startsWith('/')) return '/';
	if (raw.startsWith('//')) return '/';
	return raw;
}

export const GET: RequestHandler = async (event) => {
	const next = sanitizeNext(event.url.searchParams.get('next'));

	if (event.locals.user) {
		throw redirect(302, next);
	}

	try {
		const state = buildRandomValue(24);
		const nonce = buildRandomValue(24);
		setOAuthStateCookies(event, {
			state,
			nonce,
			next
		});

		const authorizationUrl = await buildAuthorizationUrl(event, { state, nonce });
		throw redirect(302, authorizationUrl);
	} catch (error) {
		console.error('Failed to start Keycloak login flow:', error);
		return new Response('Authentication is not configured correctly.', { status: 500 });
	}
};
