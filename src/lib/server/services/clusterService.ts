import { CoreV1Api, KubeConfig } from '@kubernetes/client-node';
import { decryptText, encryptText } from '../crypto/credentialCrypto';
import { clusterRepository } from '../repositories/clusterRepository';

export interface ClusterUpsertInput {
	server: string;
	token: string;
	skipTLSVerify?: boolean;
}

export interface ClusterDto {
	id: string;
	name: string;
	server: string;
	skipTLSVerify: boolean;
	createdAt: Date;
	updatedAt: Date;
}

export interface ClusterCredentials extends ClusterDto {
	token: string;
}

class ClusterServiceError extends Error {
	statusCode: number;

	constructor(message: string, statusCode: number) {
		super(message);
		this.name = 'ClusterServiceError';
		this.statusCode = statusCode;
	}
}

function normalizeServerUrl(input: string): string {
	if (!input || !input.trim()) {
		throw new ClusterServiceError('Server URL is required.', 400);
	}

	let candidate = input.trim();
	if (!candidate.startsWith('http://') && !candidate.startsWith('https://')) {
		candidate = `https://${candidate}`;
	}

	let url: URL;
	try {
		url = new URL(candidate);
	} catch {
		throw new ClusterServiceError('Invalid server URL format.', 400);
	}

	if (url.protocol === 'http:') {
		url.protocol = 'https:';
	}
	if (url.protocol !== 'https:') {
		throw new ClusterServiceError('Only HTTPS Kubernetes API server URLs are supported.', 400);
	}

	if (!url.port) {
		url.port = '6443';
	}

	url.pathname = '';
	url.search = '';
	url.hash = '';
	return url.toString().replace(/\/+$/, '');
}

function createTempKubeConfig(server: string, token: string, skipTLSVerify: boolean): KubeConfig {
	const kc = new KubeConfig();
	kc.loadFromOptions({
		clusters: [{ name: 'temp-cluster', server, skipTLSVerify }],
		users: [{ name: 'temp-user', token }],
		contexts: [{ name: 'temp-context', cluster: 'temp-cluster', user: 'temp-user' }],
		currentContext: 'temp-context'
	});
	return kc;
}

async function verifyClusterConnectivity(
	server: string,
	token: string,
	skipTLSVerify: boolean
): Promise<void> {
	const kc = createTempKubeConfig(server, token.trim(), skipTLSVerify);
	const coreApi = kc.makeApiClient(CoreV1Api);
	await coreApi.listNamespace({ limit: 1 });
}

function getClusterName(server: string): string {
	const parsed = new URL(server);
	return parsed.hostname || parsed.host;
}

function toClusterDto(cluster: {
	id: string;
	name: string;
	serverEncrypted: string;
	serverIv: string;
	serverTag: string;
	skipTLSVerify: boolean;
	createdAt: Date;
	updatedAt: Date;
}): ClusterDto {
	const server = decryptText(cluster.serverEncrypted, cluster.serverIv, cluster.serverTag);
	return {
		id: cluster.id,
		name: cluster.name,
		server,
		skipTLSVerify: cluster.skipTLSVerify,
		createdAt: cluster.createdAt,
		updatedAt: cluster.updatedAt
	};
}

export class ClusterService {
	async listClusters(): Promise<ClusterDto[]> {
		const clusters = await clusterRepository.list();
		return clusters.map(toClusterDto);
	}

	async getCluster(id: string): Promise<ClusterDto | null> {
		const cluster = await clusterRepository.findById(id);
		return cluster ? toClusterDto(cluster) : null;
	}

	async getClusterCredentials(id: string): Promise<ClusterCredentials | null> {
		const cluster = await clusterRepository.findById(id);
		if (!cluster) return null;

		const base = toClusterDto(cluster);
		const token = decryptText(cluster.tokenEncrypted, cluster.tokenIv, cluster.tokenTag);

		return {
			...base,
			token
		};
	}

	async createCluster(input: ClusterUpsertInput): Promise<ClusterDto> {
		const token = input.token?.trim();
		if (!token) {
			throw new ClusterServiceError('Token is required.', 400);
		}

		const skipTLSVerify = input.skipTLSVerify ?? true;
		const server = normalizeServerUrl(input.server);

		await verifyClusterConnectivity(server, token, skipTLSVerify);

		const encryptedServer = encryptText(server);
		const encryptedToken = encryptText(token);

		const created = await clusterRepository.create({
			name: getClusterName(server),
			serverEncrypted: encryptedServer.ciphertext,
			serverIv: encryptedServer.iv,
			serverTag: encryptedServer.tag,
			tokenEncrypted: encryptedToken.ciphertext,
			tokenIv: encryptedToken.iv,
			tokenTag: encryptedToken.tag,
			skipTLSVerify
		});

		return toClusterDto(created);
	}

	async updateCluster(id: string, input: ClusterUpsertInput): Promise<ClusterDto> {
		const existing = await clusterRepository.findById(id);
		if (!existing) {
			throw new ClusterServiceError('Cluster not found.', 404);
		}

		const token = input.token?.trim();
		if (!token) {
			throw new ClusterServiceError('Token is required.', 400);
		}

		const skipTLSVerify = input.skipTLSVerify ?? true;
		const server = normalizeServerUrl(input.server);

		await verifyClusterConnectivity(server, token, skipTLSVerify);

		const encryptedServer = encryptText(server);
		const encryptedToken = encryptText(token);

		const updated = await clusterRepository.update(id, {
			name: getClusterName(server),
			serverEncrypted: encryptedServer.ciphertext,
			serverIv: encryptedServer.iv,
			serverTag: encryptedServer.tag,
			tokenEncrypted: encryptedToken.ciphertext,
			tokenIv: encryptedToken.iv,
			tokenTag: encryptedToken.tag,
			skipTLSVerify
		});

		return toClusterDto(updated);
	}

	async deleteCluster(id: string): Promise<void> {
		const existing = await clusterRepository.findById(id);
		if (!existing) {
			throw new ClusterServiceError('Cluster not found.', 404);
		}
		await clusterRepository.delete(id);
	}
}

export const clusterService = new ClusterService();
