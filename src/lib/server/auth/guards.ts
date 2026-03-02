import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import type { AppPermission } from '$lib/types/auth';
import { hasPermission } from './permissions';

export function unauthorizedApiResponse(message = 'Authentication required') {
	return json(
		{
			error: 'Unauthorized',
			message
		},
		{ status: 401 }
	);
}

export function forbiddenApiResponse(
	message = 'You do not have permission to perform this action'
) {
	return json(
		{
			error: 'Forbidden',
			message
		},
		{ status: 403 }
	);
}

export function requireAuthenticated(event: RequestEvent): Response | null {
	if (!event.locals.user) {
		return unauthorizedApiResponse();
	}

	return null;
}

export function requirePermission(event: RequestEvent, permission: AppPermission): Response | null {
	const authError = requireAuthenticated(event);
	if (authError) return authError;

	if (!hasPermission(event.locals.permissions, permission)) {
		return forbiddenApiResponse(`Missing required permission: ${permission}`);
	}

	return null;
}

export function requireAdmin(event: RequestEvent): Response | null {
	const authError = requireAuthenticated(event);
	if (authError) return authError;

	if (!event.locals.isAdmin) {
		return forbiddenApiResponse('Administrator privileges are required.');
	}

	return null;
}
