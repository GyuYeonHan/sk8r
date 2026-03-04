import type { RequestHandler } from './$types';
import { CoreV1Api, Log } from '@kubernetes/client-node';
import { Writable } from 'stream';
import { createKubeConfig, credentialErrorResponse } from '$lib/server/k8sAuth';
import { resolveK8sCredentials } from '$lib/server/clusterContext';

export const GET: RequestHandler = async (event) => {
	const resolved = await resolveK8sCredentials(event);
	if ('error' in resolved) {
		return credentialErrorResponse(resolved.error);
	}
	const credentials = resolved.credentials;
	const { params, url } = event;

	const { namespace, name } = params;
	const container = url.searchParams.get('container') || undefined;
	const follow = url.searchParams.get('follow') === 'true';
	const tailLines = parseInt(url.searchParams.get('tailLines') || '100', 10);
	const timestamps = url.searchParams.get('timestamps') === 'true';
	const previous = url.searchParams.get('previous') === 'true';

	// Load kubeconfig from credentials
	const kc = createKubeConfig(credentials.server, credentials.token, credentials.skipTLSVerify);
	const coreApi = kc.makeApiClient(CoreV1Api);
	const log = new Log(kc);
	let logAbortController: AbortController | null = null;
	let logStreamRef: Writable | null = null;
	let endTimer: ReturnType<typeof setTimeout> | null = null;

	const cleanupLogStream = () => {
		if (endTimer) {
			clearTimeout(endTimer);
			endTimer = null;
		}
		if (logAbortController) {
			logAbortController.abort();
			logAbortController = null;
		}
		if (logStreamRef && !logStreamRef.destroyed) {
			logStreamRef.destroy();
		}
		logStreamRef = null;
	};

	event.request.signal.addEventListener('abort', cleanupLogStream, { once: true });

	// Create a readable stream for SSE
	const stream = new ReadableStream({
		async start(controller) {
			const encoder = new TextEncoder();
			let streamClosed = false;

			const closeStreamSafely = () => {
				if (streamClosed) return;
				streamClosed = true;
				try {
					controller.close();
				} catch {
					// Stream may already be closed/cancelled
				}
			};

			const sendEvent = (data: string, event?: string) => {
				try {
					let message = '';
					if (event) {
						message += `event: ${event}\n`;
					}
					message += `data: ${JSON.stringify(data)}\n\n`;
					controller.enqueue(encoder.encode(message));
				} catch {
					// Stream may already be closed/cancelled
				}
			};

			try {
				// Send initial connection event
				sendEvent('Connected to pod logs', 'connected');

				// Buffer for incomplete lines
				let buffer = '';

				// Create a writable stream to capture log output
				const logStream = new Writable({
					write(chunk: Buffer, _encoding, callback) {
						const text = chunk.toString('utf8');
						buffer += text;

						// Split by newlines and send complete lines
						const lines = buffer.split('\n');
						buffer = lines.pop() || ''; // Keep incomplete line in buffer

						for (const line of lines) {
							if (line.trim()) {
								sendEvent(line, 'log');
							}
						}
						callback();
					},
					final(callback) {
						// Send any remaining buffer content
						if (buffer.trim()) {
							sendEvent(buffer, 'log');
						}
						sendEvent('Log stream ended', 'end');
						closeStreamSafely();
						callback();
					}
				});
				logStreamRef = logStream;

				logStream.on('error', (err) => {
					sendEvent(`Error: ${err.message}`, 'error');
					closeStreamSafely();
				});

				// Start streaming logs
				let containerName = container;
				if (!containerName) {
					const pod = await coreApi.readNamespacedPod({ name, namespace });
					const firstContainer = pod.spec?.containers?.[0]?.name;
					if (!firstContainer) {
						throw new Error('No container found in pod');
					}
					containerName = firstContainer;
				}

				logAbortController = await log.log(namespace, name, containerName, logStream, {
					follow,
					tailLines,
					timestamps,
					previous
				});

				// If not following, the stream will end naturally
				if (!follow) {
					// Give some time for the stream to complete
					endTimer = setTimeout(() => {
						if (logStreamRef && !logStreamRef.destroyed) {
							logStreamRef.end(); // Signal end of stream
						}
						endTimer = null;
					}, 1000);
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : 'Unknown error';
				sendEvent(`Failed to stream logs: ${message}`, 'error');
				closeStreamSafely();
				cleanupLogStream();
			}
		},

		cancel() {
			// Cleanup when client disconnects
			console.log('Client disconnected from log stream');
			cleanupLogStream();
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive',
			'X-Accel-Buffering': 'no' // Disable nginx buffering
		}
	});
};
