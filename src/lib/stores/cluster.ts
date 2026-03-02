import { writable, derived } from 'svelte/store';

export interface ClusterContext {
	name: string;
	cluster: string;
	user: string;
	namespace?: string;
	isCurrent: boolean;
	server?: string;
}

export interface CustomCluster {
	id: string;
	server: string;
	name: string;
	skipTLSVerify: boolean;
	isCurrent?: boolean;
	createdAt?: string;
	updatedAt?: string;
}

export interface ClusterState {
	contexts: ClusterContext[];
	customClusters: CustomCluster[];
	currentContext: string;
	currentCustomClusterId: string | null;
	loading: boolean;
	error: string | null;
}

interface ClustersApiResponse {
	clusters: Array<{
		id: string;
		name: string;
		server: string;
		skipTLSVerify: boolean;
		createdAt: string;
		updatedAt: string;
	}>;
	currentClusterId: string | null;
}

function toContext(cluster: CustomCluster): ClusterContext {
	return {
		name: cluster.id,
		cluster: cluster.name,
		user: 'server-managed',
		isCurrent: !!cluster.isCurrent,
		server: cluster.server
	};
}

function extractErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return 'Unknown error';
}

async function parseErrorResponse(response: Response): Promise<string> {
	try {
		const payload = await response.json();
		return payload.message || payload.error || response.statusText;
	} catch {
		return response.statusText;
	}
}

function createClusterStore() {
	const { subscribe, set, update } = writable<ClusterState>({
		contexts: [],
		customClusters: [],
		currentContext: '',
		currentCustomClusterId: null,
		loading: false,
		error: null
	});

	const fetchAndSetClusters = async () => {
		const response = await fetch('/api/clusters');
		if (!response.ok) {
			throw new Error(await parseErrorResponse(response));
		}

		const payload = (await response.json()) as ClustersApiResponse;
		const currentId = payload.currentClusterId;
		const clusters: CustomCluster[] = (payload.clusters || []).map((cluster) => ({
			...cluster,
			isCurrent: cluster.id === currentId
		}));

		update(state => ({
			...state,
			customClusters: clusters,
			contexts: clusters.map(toContext),
			currentCustomClusterId: currentId,
			currentContext: currentId || '',
			loading: false
		}));

		return {
			contexts: clusters.map(toContext),
			currentContext: currentId || '',
			totalContexts: clusters.length
		};
	};

	const switchCluster = async (clusterId: string) => {
		const response = await fetch('/api/clusters/select', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ clusterId })
		});

		if (!response.ok) {
			throw new Error(await parseErrorResponse(response));
		}

		update(state => ({
			...state,
			currentCustomClusterId: clusterId,
			currentContext: clusterId,
			customClusters: state.customClusters.map(c => ({
				...c,
				isCurrent: c.id === clusterId
			})),
			loading: false
		}));

		return { success: true, currentContext: clusterId };
	};

	return {
		subscribe,

		// Fetch available contexts from the API
		async fetchContexts() {
			update(state => ({ ...state, loading: true, error: null }));

			try {
				return await fetchAndSetClusters();
			} catch (error) {
				const message = extractErrorMessage(error);
				update(state => ({ ...state, loading: false, error: message }));
				throw error;
			}
		},

		// Switch current cluster (server-managed via HttpOnly cookie)
		async switchContext(clusterId: string) {
			update(state => ({ ...state, loading: true, error: null }));

			try {
				return await switchCluster(clusterId);
			} catch (error) {
				const message = extractErrorMessage(error);
				update(state => ({ ...state, loading: false, error: message }));
				throw error;
			}
		},

		setError: (error: string | null) => update(state => ({ ...state, error })),

		// Add a new cluster
		async addCluster(server: string, token: string, skipTLSVerify: boolean = true): Promise<CustomCluster> {
			update(state => ({ ...state, loading: true, error: null }));

			try {
				const response = await fetch('/api/clusters', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ server, token, skipTLSVerify })
				});

				if (!response.ok) {
					throw new Error(await parseErrorResponse(response));
				}

				const payload = await response.json();
				const cluster = payload.cluster as CustomCluster;
				await fetchAndSetClusters();
				return cluster;
			} catch (error) {
				const message = extractErrorMessage(error);
				update(state => ({ ...state, loading: false, error: message }));
				throw error;
			}
		},

		// Update an existing cluster
		async updateCluster(id: string, server: string, token: string, skipTLSVerify: boolean = true): Promise<CustomCluster> {
			update(state => ({ ...state, loading: true, error: null }));

			try {
				const response = await fetch(`/api/clusters/${id}`, {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ server, token, skipTLSVerify })
				});

				if (!response.ok) {
					throw new Error(await parseErrorResponse(response));
				}

				const payload = await response.json();
				const cluster = payload.cluster as CustomCluster;
				await fetchAndSetClusters();
				return cluster;
			} catch (error) {
				const message = extractErrorMessage(error);
				update(state => ({ ...state, loading: false, error: message }));
				throw error;
			}
		},

		// Remove a cluster
		async removeCluster(id: string) {
			update(state => ({ ...state, loading: true, error: null }));

			try {
				const response = await fetch(`/api/clusters/${id}`, {
					method: 'DELETE'
				});

				if (!response.ok) {
					throw new Error(await parseErrorResponse(response));
				}

				await fetchAndSetClusters();
			} catch (error) {
				const message = extractErrorMessage(error);
				update(state => ({ ...state, loading: false, error: message }));
				throw error;
			}
		},

		// Retained for backward compatibility
		getClusterToken(_clusterId: string): string | null {
			return null;
		},

		// Switch to a custom cluster (alias)
		async switchToCustomCluster(clusterId: string) {
			update(state => ({ ...state, loading: true, error: null }));
			try {
				return await switchCluster(clusterId);
			} catch (error) {
				const message = extractErrorMessage(error);
				update(state => ({ ...state, loading: false, error: message }));
				throw error;
			}
		},

		reset: () => {
			set({
				contexts: [],
				customClusters: [],
				currentContext: '',
				currentCustomClusterId: null,
				loading: false,
				error: null
			});
		}
	};
}

export const clusterStore = createClusterStore();

// Derived store for the current context details
export const currentCluster = derived(clusterStore, $store => {
	return $store.contexts.find(ctx => ctx.isCurrent) || null;
});
