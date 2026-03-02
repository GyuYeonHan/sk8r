// Custom production server with WebSocket support
import { handler } from './build/handler.js';
import express from 'express';
import { createServer } from 'http';
import { createWebSocketServer, handleUpgrade, cleanupAllConnections } from './websocket.js';

function assertEncryptionKeyConfigured() {
	const raw = process.env.APP_ENCRYPTION_KEY;
	if (!raw) {
		throw new Error(
			'APP_ENCRYPTION_KEY is required. Set a 32-byte base64 key before starting the server.'
		);
	}

	const decoded = Buffer.from(raw, 'base64');
	if (decoded.length !== 32) {
		throw new Error('APP_ENCRYPTION_KEY must decode to exactly 32 bytes.');
	}
}

assertEncryptionKeyConfigured();

const app = express();
const server = createServer(app);

// Create WebSocket server
const wss = createWebSocketServer();

// Handle WebSocket upgrades
server.on('upgrade', (request, socket, head) => {
	const url = new URL(request.url || '', `http://${request.headers.host}`);

	// Only handle exec endpoint
	if (url.pathname.match(/^\/api\/pods\/[^/]+\/[^/]+\/exec$/)) {
		handleUpgrade(wss, request, socket, head);
	} else {
		socket.destroy();
	}
});

// Let SvelteKit handle everything else
app.use(handler);

const port = process.env.PORT || 3000;
server.listen(port, () => {
	console.log(`Server listening on port ${port}`);
});

async function shutdown(signal) {
	console.log(`${signal} received, shutting down...`);
	await cleanupAllConnections();
	server.close(() => {
		console.log('Server closed');
		process.exit(0);
	});
}

// Graceful shutdown
process.on('SIGTERM', () => {
	void shutdown('SIGTERM');
});

process.on('SIGINT', () => {
	void shutdown('SIGINT');
});
