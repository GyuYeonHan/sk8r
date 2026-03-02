import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { K8sApiServiceSimple } from '$lib/services/k8sApiSimple';
import { credentialErrorResponse } from '$lib/server/k8sAuth';
import { resolveK8sCredentials } from '$lib/server/clusterContext';
import { requirePermission } from '$lib/server/auth/guards';

export const GET: RequestHandler = async (event) => {
	const resolved = await resolveK8sCredentials(event);
	if ('error' in resolved) {
		return credentialErrorResponse(resolved.error);
	}
	const credentials = resolved.credentials;
	const { params, url } = event;

	const { type, name } = params;
	const namespace = url.searchParams.get('namespace') || 'default';

	try {
		const k8sApi = new K8sApiServiceSimple(
			credentials.server,
			credentials.token,
			credentials.skipTLSVerify
		);
		const resource = await k8sApi.getResource(type, name, namespace);
		return json(resource);
	} catch (error) {
		console.error(`Failed to get resource ${type}/${name}:`, error);
		return json(
			{ error: error instanceof Error ? error.message : 'Failed to get resource' },
			{ status: 500 }
		);
	}
};

export const DELETE: RequestHandler = async (event) => {
	const permissionError = requirePermission(event, 'resource:write');
	if (permissionError) return permissionError;

	const resolved = await resolveK8sCredentials(event);
	if ('error' in resolved) {
		return credentialErrorResponse(resolved.error);
	}
	const credentials = resolved.credentials;
	const { params, request } = event;

	const { type, name } = params;
	const body = await request.json();
	const namespace = body.namespace || 'default';

	try {
		const k8sApi = new K8sApiServiceSimple(
			credentials.server,
			credentials.token,
			credentials.skipTLSVerify
		);
		await k8sApi.deleteResource(type, name, namespace);

		return json({ success: true });
	} catch (error) {
		console.error('Failed to delete resource:', error);
		return json(
			{ error: error instanceof Error ? error.message : 'Failed to delete resource' },
			{ status: 500 }
		);
	}
};
