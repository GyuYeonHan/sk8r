import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { K8sApiServiceSimple } from '$lib/services/k8sApiSimple';
import { credentialErrorResponse } from '$lib/server/k8sAuth';
import { resolveK8sCredentials } from '$lib/server/clusterContext';

export const GET: RequestHandler = async (event) => {
	const resolved = await resolveK8sCredentials(event);
	if ('error' in resolved) {
		return credentialErrorResponse(resolved.error);
	}
	const credentials = resolved.credentials;

	const { url } = event;

	const resourceType = url.searchParams.get('type');
	const namespace = url.searchParams.get('namespace') || '*';

	if (!resourceType) {
		return json({ error: 'Resource type is required' }, { status: 400 });
	}

	try {
		const k8sApi = new K8sApiServiceSimple(
			credentials.server,
			credentials.token,
			credentials.skipTLSVerify
		);
		const response = await k8sApi.listResources(resourceType, { namespace });
		
		// Convert to serializable objects
		const serializedItems = (response?.items || []).map(item => 
			JSON.parse(JSON.stringify(item))
		);

		return json({
			items: serializedItems,
			apiVersion: response.apiVersion,
			kind: response.kind
		});
	} catch (error) {
		console.error(`Failed to list ${resourceType}:`, error);
		return json(
			{ error: error instanceof Error ? error.message : 'Failed to list resources' },
			{ status: 500 }
		);
	}
};
