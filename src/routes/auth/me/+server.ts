import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	if (!event.locals.user) {
		return json({ error: 'Unauthorized', message: 'Authentication required' }, { status: 401 });
	}

	return json({
		user: event.locals.user,
		isAdmin: event.locals.isAdmin,
		permissions: Array.from(event.locals.permissions)
	});
};
