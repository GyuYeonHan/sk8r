import { json } from '@sveltejs/kit';
import { KubeConfig } from '@kubernetes/client-node';
import type { CredentialResolveError } from './clusterContext';

export interface K8sCredentials {
	server: string;
	token: string;
	skipTLSVerify: boolean;
}

/**
 * Create a 401 Unauthorized response
 */
export function unauthorizedResponse(message = 'Missing or invalid Kubernetes credentials') {
	return json(
		{ error: 'Unauthorized', message },
		{ status: 401 }
	);
}

/**
 * Convert credential resolution error into an HTTP response.
 */
export function credentialErrorResponse(error: CredentialResolveError) {
	switch (error) {
		case 'NO_CLUSTER_SELECTED':
			return json(
				{
					error: 'No cluster selected',
					message: 'Select a cluster first before making Kubernetes API requests.'
				},
				{ status: 400 }
			);
		case 'CLUSTER_NOT_FOUND':
			return json(
				{
					error: 'Cluster not found',
					message: 'The selected cluster no longer exists.'
				},
				{ status: 401 }
			);
		case 'DECRYPT_FAILED':
			return json(
				{
					error: 'Credential decryption failed',
					message: 'Failed to decrypt stored cluster credentials.'
				},
				{ status: 500 }
			);
		default:
			return unauthorizedResponse();
	}
}

/**
 * Create a KubeConfig from server URL and token
 */
export function createKubeConfig(server: string, token: string, skipTLSVerify: boolean = true): KubeConfig {
	const kc = new KubeConfig();
	kc.loadFromOptions({
		clusters: [{ name: 'current-cluster', server: server.replace(/\/+$/, ''), skipTLSVerify }],
		users: [{ name: 'current-user', token }],
		contexts: [{ name: 'current-context', cluster: 'current-cluster', user: 'current-user' }],
		currentContext: 'current-context'
	});
	return kc;
}
