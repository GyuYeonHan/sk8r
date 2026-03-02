import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { clusterService } from '$lib/server/services/clusterService';
import { getCurrentClusterId, setCurrentClusterId } from '$lib/server/clusterContext';
import { requireAdmin } from '$lib/server/auth/guards';

function extractErrorStatus(error: any): number {
	return error?.statusCode || error?.response?.statusCode || 400;
}

function extractErrorMessage(error: any): string {
	if (error?.body?.message) return error.body.message;
	if (error?.body?.reason) return error.body.reason;
	if (typeof error?.body === 'string') return error.body;
	if (error instanceof Error) return error.message;
	return 'Unknown error';
}

export const PUT: RequestHandler = async (event) => {
	const adminError = requireAdmin(event);
	if (adminError) return adminError;

	const { params, request } = event;
	try {
		const body = await request.json();
		const { server, token, skipTLSVerify = true } = body || {};

		if (!server || !token) {
			return json({ error: 'Server URL and token are required' }, { status: 400 });
		}

		const updated = await clusterService.updateCluster(params.id, {
			server,
			token,
			skipTLSVerify
		});

		return json({ cluster: updated });
	} catch (error) {
		console.error('Failed to update cluster:', error);
		return json(
			{
				error: 'Failed to update cluster',
				message: extractErrorMessage(error)
			},
			{ status: extractErrorStatus(error) }
		);
	}
};

export const DELETE: RequestHandler = async (event) => {
	const adminError = requireAdmin(event);
	if (adminError) return adminError;

	try {
		const { id } = event.params;
		await clusterService.deleteCluster(id);

		if (getCurrentClusterId(event) === id) {
			setCurrentClusterId(event, null);
		}

		return json({ success: true });
	} catch (error) {
		console.error('Failed to delete cluster:', error);
		return json(
			{
				error: 'Failed to delete cluster',
				message: extractErrorMessage(error)
			},
			{ status: extractErrorStatus(error) }
		);
	}
};
