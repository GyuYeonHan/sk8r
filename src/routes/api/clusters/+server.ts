import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { clusterService } from '$lib/server/services/clusterService';
import { getCurrentClusterId } from '$lib/server/clusterContext';
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

export const GET: RequestHandler = async (event) => {
	try {
		const clusters = await clusterService.listClusters();
		const currentClusterId = getCurrentClusterId(event);

		return json({
			clusters,
			currentClusterId
		});
	} catch (error) {
		console.error('Failed to list clusters:', error);
		return json(
			{
				error: 'Failed to list clusters',
				message: extractErrorMessage(error)
			},
			{ status: 500 }
		);
	}
};

export const POST: RequestHandler = async (event) => {
	const adminError = requireAdmin(event);
	if (adminError) return adminError;

	const { request } = event;
	try {
		const body = await request.json();
		const { server, token, skipTLSVerify = true } = body || {};

		if (!server || !token) {
			return json({ error: 'Server URL and token are required' }, { status: 400 });
		}

		const created = await clusterService.createCluster({
			server,
			token,
			skipTLSVerify
		});

		return json({ cluster: created }, { status: 201 });
	} catch (error) {
		console.error('Failed to create cluster:', error);
		return json(
			{
				error: 'Failed to create cluster',
				message: extractErrorMessage(error)
			},
			{ status: extractErrorStatus(error) }
		);
	}
};
