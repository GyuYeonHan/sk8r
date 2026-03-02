import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { clusterService } from '$lib/server/services/clusterService';
import { setCurrentClusterId } from '$lib/server/clusterContext';

export const POST: RequestHandler = async (event) => {
	try {
		const body = await event.request.json();
		const { clusterId } = body || {};

		if (!clusterId || typeof clusterId !== 'string') {
			return json({ error: 'clusterId is required' }, { status: 400 });
		}

		const cluster = await clusterService.getCluster(clusterId);
		if (!cluster) {
			return json({ error: 'Cluster not found' }, { status: 404 });
		}

		setCurrentClusterId(event, clusterId);
		return json({ success: true, currentClusterId: clusterId });
	} catch (error) {
		console.error('Failed to select cluster:', error);
		return json(
			{
				error: 'Failed to select cluster',
				message: error instanceof Error ? error.message : 'Unknown error'
			},
			{ status: 500 }
		);
	}
};
