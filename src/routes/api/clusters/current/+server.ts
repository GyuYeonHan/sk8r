import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getCurrentClusterId } from '$lib/server/clusterContext';

export const GET: RequestHandler = async (event) => {
	return json({
		currentClusterId: getCurrentClusterId(event)
	});
};
