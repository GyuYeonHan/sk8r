// Shared runtime entrypoint:
// - dev (vite plugin) imports this TS module
// - prod (server.js) imports /websocket.js directly
// To avoid dev/prod drift, websocket logic lives only in /websocket.js.
export {
	createWebSocketServer,
	handleUpgrade,
	cleanupAllConnections
} from '../../../websocket.js';
