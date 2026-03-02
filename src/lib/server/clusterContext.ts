import type { RequestEvent } from '@sveltejs/kit';
import { clusterService } from './services/clusterService';
import type { K8sCredentials } from './k8sAuth';

export const CLUSTER_COOKIE_NAME = 'k8s_cluster_id';

const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

const cookieOptions = {
	path: '/',
	httpOnly: true,
	sameSite: 'lax' as const,
	secure: process.env.NODE_ENV === 'production',
	maxAge: COOKIE_MAX_AGE
};

export type CredentialResolveError =
	| 'NO_CLUSTER_SELECTED'
	| 'CLUSTER_NOT_FOUND'
	| 'DECRYPT_FAILED';

export type CredentialResolveResult =
	| { credentials: K8sCredentials }
	| { error: CredentialResolveError };

export function getCurrentClusterId(event: RequestEvent): string | null {
	return event.cookies.get(CLUSTER_COOKIE_NAME) ?? null;
}

export function setCurrentClusterId(event: RequestEvent, clusterId: string | null): void {
	if (!clusterId) {
		event.cookies.delete(CLUSTER_COOKIE_NAME, { path: '/' });
		return;
	}

	event.cookies.set(CLUSTER_COOKIE_NAME, clusterId, cookieOptions);
}

async function resolveFromClusterId(clusterId: string | null): Promise<CredentialResolveResult> {
	if (!clusterId) {
		return { error: 'NO_CLUSTER_SELECTED' };
	}

	try {
		const cluster = await clusterService.getClusterCredentials(clusterId);
		if (!cluster) {
			return { error: 'CLUSTER_NOT_FOUND' };
		}

		return {
			credentials: {
				server: cluster.server,
				token: cluster.token,
				skipTLSVerify: cluster.skipTLSVerify
			}
		};
	} catch (error) {
		console.error('Failed to resolve cluster credentials:', error);
		return { error: 'DECRYPT_FAILED' };
	}
}

export async function resolveK8sCredentials(event: RequestEvent): Promise<CredentialResolveResult> {
	return resolveFromClusterId(getCurrentClusterId(event));
}

export function getClusterIdFromCookieHeader(cookieHeader?: string | null): string | null {
	if (!cookieHeader) return null;

	const cookieParts = cookieHeader.split(';');
	for (const rawPart of cookieParts) {
		const part = rawPart.trim();
		if (!part.startsWith(`${CLUSTER_COOKIE_NAME}=`)) continue;
		const value = part.slice(CLUSTER_COOKIE_NAME.length + 1).trim();
		return decodeURIComponent(value);
	}

	return null;
}

export async function resolveK8sCredentialsFromCookieHeader(
	cookieHeader?: string | null
): Promise<CredentialResolveResult> {
	return resolveFromClusterId(getClusterIdFromCookieHeader(cookieHeader));
}
