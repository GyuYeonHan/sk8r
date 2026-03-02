// Standalone WebSocket server for pod exec functionality
import { WebSocketServer, WebSocket } from 'ws';
import { Exec, KubeConfig } from '@kubernetes/client-node';
import { PrismaClient } from '@prisma/client';
import crypto from 'node:crypto';
import * as stream from 'stream';

const KEY_BYTES = 32;
const CLUSTER_COOKIE_NAME = 'k8s_cluster_id';
const AUTH_SESSION_COOKIE_NAME = 'sk8r_auth_session';

const prisma = new PrismaClient({
	log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error']
});

// Store active connections for cleanup
const activeConnections = new Map();

let cachedKey = null;
let cachedSessionKey = null;

function readEncryptionKey() {
	if (cachedKey) {
		return cachedKey;
	}

	const raw = process.env.APP_ENCRYPTION_KEY;
	if (!raw) {
		throw new Error(
			'APP_ENCRYPTION_KEY is required. Set a 32-byte base64 key in environment variables.'
		);
	}

	const key = Buffer.from(raw, 'base64');
	if (key.length !== KEY_BYTES) {
		throw new Error('APP_ENCRYPTION_KEY must decode to exactly 32 bytes.');
	}

	cachedKey = key;
	return key;
}

function decryptText(ciphertext, iv, tag) {
	const key = readEncryptionKey();
	const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
	decipher.setAuthTag(Buffer.from(tag, 'base64'));

	const decrypted = Buffer.concat([
		decipher.update(Buffer.from(ciphertext, 'base64')),
		decipher.final()
	]);

	return decrypted.toString('utf8');
}

function readSessionKey() {
	if (cachedSessionKey) {
		return cachedSessionKey;
	}

	const raw = process.env.AUTH_SESSION_SECRET || process.env.APP_ENCRYPTION_KEY;
	if (!raw) {
		throw new Error('AUTH_SESSION_SECRET (or APP_ENCRYPTION_KEY fallback) is required.');
	}

	const key = Buffer.from(raw, 'base64');
	if (key.length !== KEY_BYTES) {
		throw new Error('AUTH_SESSION_SECRET must decode to exactly 32 bytes.');
	}

	cachedSessionKey = key;
	return key;
}

function decryptAuthSession(cookieValue) {
	try {
		const key = readSessionKey();
		const serializedPayload = Buffer.from(cookieValue, 'base64url').toString('utf8');
		const payload = JSON.parse(serializedPayload);
		if (!payload.iv || !payload.tag || !payload.ciphertext) {
			return null;
		}

		const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64'));
		decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
		const decrypted = Buffer.concat([
			decipher.update(Buffer.from(payload.ciphertext, 'base64')),
			decipher.final()
		]);
		const session = JSON.parse(decrypted.toString('utf8'));
		const now = Math.floor(Date.now() / 1000);
		if (!session || typeof session !== 'object' || session.expiresAt <= now) {
			return null;
		}

		return session;
	} catch {
		return null;
	}
}

function getClusterIdFromCookieHeader(cookieHeader) {
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

function getCookieValue(cookieHeader, name) {
	if (!cookieHeader) return null;

	for (const rawPart of cookieHeader.split(';')) {
		const part = rawPart.trim();
		if (!part.startsWith(`${name}=`)) continue;
		const value = part.slice(name.length + 1).trim();
		return decodeURIComponent(value);
	}

	return null;
}

function createKubeConfig(server, token, skipTLSVerify = true) {
	const kc = new KubeConfig();
	kc.loadFromOptions({
		clusters: [{ name: 'current-cluster', server: server.replace(/\/+$/, ''), skipTLSVerify }],
		users: [{ name: 'current-user', token }],
		contexts: [{ name: 'current-context', cluster: 'current-cluster', user: 'current-user' }],
		currentContext: 'current-context'
	});
	return kc;
}

async function resolveK8sCredentials(request) {
	const cookieHeader = Array.isArray(request.headers.cookie)
		? request.headers.cookie.join('; ')
		: request.headers.cookie;
	const clusterId = getClusterIdFromCookieHeader(cookieHeader);

	if (!clusterId) {
		return { error: 'NO_CLUSTER_SELECTED' };
	}

	const cluster = await prisma.cluster.findUnique({ where: { id: clusterId } });
	if (!cluster) {
		return { error: 'CLUSTER_NOT_FOUND' };
	}

	try {
		return {
			credentials: {
				server: decryptText(cluster.serverEncrypted, cluster.serverIv, cluster.serverTag),
				token: decryptText(cluster.tokenEncrypted, cluster.tokenIv, cluster.tokenTag),
				skipTLSVerify: cluster.skipTLSVerify
			}
		};
	} catch (error) {
		console.error('[WebSocket] Failed to decrypt cluster credentials:', error);
		return { error: 'DECRYPT_FAILED' };
	}
}

function credentialResolveErrorMessage(error) {
	switch (error) {
		case 'NO_CLUSTER_SELECTED':
			return 'No cluster selected';
		case 'CLUSTER_NOT_FOUND':
			return 'Selected cluster not found';
		case 'DECRYPT_FAILED':
			return 'Failed to decrypt cluster credentials';
		default:
			return 'Failed to resolve cluster credentials';
	}
}

export function createWebSocketServer() {
	const wss = new WebSocketServer({ noServer: true });

	wss.on('connection', (ws, request) => {
		void handleConnection(ws, request);
	});

	return wss;
}

async function handleConnection(ws, request) {
	try {
		const url = new URL(request.url || '', `http://${request.headers.host}`);
		const pathMatch = url.pathname.match(/^\/api\/pods\/([^/]+)\/([^/]+)\/exec$/);

		if (!pathMatch) {
			ws.close(1008, 'Invalid path');
			return;
		}

		const cookieHeader = Array.isArray(request.headers.cookie)
			? request.headers.cookie.join('; ')
			: request.headers.cookie;
		const sessionCookie = getCookieValue(cookieHeader, AUTH_SESSION_COOKIE_NAME);
		const authSession = sessionCookie ? decryptAuthSession(sessionCookie) : null;
		if (!authSession) {
			ws.send('\x1b[31mError: Authentication required\x1b[0m\r\n');
			ws.close(1008, 'Authentication required');
			return;
		}
		if (!Array.isArray(authSession.permissions) || !authSession.permissions.includes('pod:exec')) {
			ws.send('\x1b[31mError: Admin permission required for pod exec\x1b[0m\r\n');
			ws.close(1008, 'Admin permission required');
			return;
		}

		const resolved = await resolveK8sCredentials(request);
		if ('error' in resolved) {
			const message = credentialResolveErrorMessage(resolved.error);
			ws.send(`\x1b[31mError: ${message}\x1b[0m\r\n`);
			ws.close(1008, message);
			return;
		}

		const namespace = decodeURIComponent(pathMatch[1]);
		const podName = decodeURIComponent(pathMatch[2]);
		const container = url.searchParams.get('container') || undefined;
		const command = url.searchParams.get('command') || '/bin/sh';

		await handleExecConnection(ws, namespace, podName, container, command, resolved.credentials);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		ws.send(`\x1b[31mError: ${message}\x1b[0m\r\n`);
		ws.close(1011, message);
	}
}

export function handleUpgrade(wss, request, socket, head) {
	const url = new URL(request.url || '', `http://${request.headers.host}`);

	// Only handle exec endpoint
	if (!url.pathname.match(/^\/api\/pods\/[^/]+\/[^/]+\/exec$/)) {
		socket.destroy();
		return;
	}

	wss.handleUpgrade(request, socket, head, (ws) => {
		wss.emit('connection', ws, request);
	});
}

async function handleExecConnection(ws, namespace, podName, container, command, credentials) {
	const connectionId = `${namespace}/${podName}/${container || 'default'}/${Date.now()}`;

	console.log(`[WebSocket] New exec connection: ${connectionId}`);

	const kc = createKubeConfig(credentials.server, credentials.token, credentials.skipTLSVerify);
	const exec = new Exec(kc);

	// Track K8s connection for cleanup
	let k8sConnection = {
		stdin: null,
		close: () => {}
	};

	const cleanup = () => {
		console.log(`[WebSocket] Cleaning up connection: ${connectionId}`);
		k8sConnection.close();
		activeConnections.delete(connectionId);
	};

	activeConnections.set(connectionId, { ws, cleanup });

	const sendToClient = (data) => {
		if (ws.readyState === WebSocket.OPEN) {
			try {
				ws.send(typeof data === 'string' ? data : data.toString('utf8'));
			} catch (err) {
				console.error('[WebSocket] Error sending to client:', err);
			}
		}
	};

	try {
		// Create streams for K8s exec output
		const stdout = new stream.Writable({
			write(chunk, _encoding, callback) {
				sendToClient(chunk);
				callback();
			}
		});

		const stderr = new stream.Writable({
			write(chunk, _encoding, callback) {
				sendToClient(chunk);
				callback();
			}
		});

		// Handle incoming messages from browser
		ws.on('message', (data) => {
			const message = typeof data === 'string' ? data : data.toString('utf8');

			// Check if it's a control message (JSON)
			if (message.startsWith('{')) {
				try {
					const msg = JSON.parse(message);
					if (msg.type === 'resize' && msg.cols && msg.rows) {
						// Terminal resize - K8s exec doesn't support resize after connection
						// but we acknowledge it to prevent errors
						console.log(`[WebSocket] Resize request: ${msg.cols}x${msg.rows}`);
						return;
					}
				} catch {
					// Not valid JSON, treat as regular input
				}
			}

			// Send to K8s stdin
			if (k8sConnection.stdin && !k8sConnection.stdin.destroyed) {
				k8sConnection.stdin.write(message);
			}
		});

		ws.on('close', () => {
			console.log(`[WebSocket] Client disconnected: ${connectionId}`);
			cleanup();
		});

		ws.on('error', (error) => {
			console.error(`[WebSocket] Error: ${connectionId}`, error);
			cleanup();
		});

		// Send connection message
		sendToClient(
			`\x1b[32mConnecting to ${podName}${container ? `/${container}` : ''}...\x1b[0m\r\n`
		);

		// Try different shells
		const shellCommands =
			command === '/bin/sh' ? ['/bin/sh', '/bin/bash', '/bin/ash', 'sh'] : [command];

		let lastError = null;

		for (const shell of shellCommands) {
			try {
				console.log(`[WebSocket] Trying shell: ${shell}`);

				// Create a passthrough stream for stdin
				const stdinStream = new stream.PassThrough();
				k8sConnection.stdin = stdinStream;

				await new Promise((resolve, reject) => {
					exec
						.exec(
							namespace,
							podName,
							container || '',
							[shell],
							stdout,
							stderr,
							stdinStream,
							true, // tty
							(status) => {
								console.log(`[WebSocket] Exec completed for ${connectionId}:`, status);
								if (ws.readyState === WebSocket.OPEN) {
									sendToClient('\r\n\x1b[33m[Session ended]\x1b[0m\r\n');
									ws.close(1000, 'Session ended');
								}
							}
						)
						.then((execWebSocket) => {
							console.log(`[WebSocket] Exec started successfully with ${shell}`);

							// Store close function
							k8sConnection.close = () => {
								if (stdinStream && !stdinStream.destroyed) {
									stdinStream.end();
								}
								if (execWebSocket && typeof execWebSocket.close === 'function') {
									try {
										execWebSocket.close();
									} catch {
										// Ignore close errors
									}
								}
							};

							resolve();
						})
						.catch(reject);
				});

				// If we got here, the shell worked
				lastError = null;
				break;
			} catch (err) {
				lastError = err;
				console.log(`[WebSocket] Shell ${shell} failed:`, err.message);
			}
		}

		if (lastError) {
			throw lastError;
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		console.error(`[WebSocket] Exec error for ${connectionId}:`, message);
		sendToClient(`\r\n\x1b[31mError: ${message}\x1b[0m\r\n`);
		sendToClient('\r\n\x1b[33mMake sure the pod is running and the container exists.\x1b[0m\r\n');
		ws.close(1011, message);
		cleanup();
	}
}

// Cleanup all connections on shutdown
export async function cleanupAllConnections() {
	console.log(`[WebSocket] Cleaning up ${activeConnections.size} connections`);
	for (const [, { cleanup }] of activeConnections) {
		cleanup();
	}
	activeConnections.clear();

	await prisma.$disconnect().catch((error) => {
		console.error('[WebSocket] Failed to disconnect Prisma client:', error);
	});
}
