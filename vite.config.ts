import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type TestProjectConfiguration } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import { sveltekit } from '@sveltejs/kit/vite';
import type { Plugin } from 'vite';
import { version } from './package.json';

const configuredHttpServers = new WeakSet<object>();
const browserTestsEnabled = process.env.VITEST_BROWSER === '1';
const browserProjects: TestProjectConfiguration[] = browserTestsEnabled
	? [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					browser: {
						enabled: true,
						provider: playwright(),
						instances: [{ browser: 'chromium', headless: true }]
					},
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**']
				}
			}
		]
	: [];

const serverProject: TestProjectConfiguration = {
	extends: './vite.config.ts',
	test: {
		name: 'server',
		environment: 'node',
		include: ['src/**/*.{test,spec}.{js,ts}'],
		exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
	}
};

// WebSocket plugin for development server
function webSocketPlugin(): Plugin {
	return {
		name: 'websocket-plugin',
		async configureServer(server) {
			const httpServer = server.httpServer;
			if (!httpServer) {
				return;
			}

			if (configuredHttpServers.has(httpServer)) {
				return;
			}
			configuredHttpServers.add(httpServer);

			try {
				// Dynamically import the shared WebSocket runtime
				const { createWebSocketServer, handleUpgrade, cleanupAllConnections } =
					await import('./src/lib/server/websocket');
				const wss = createWebSocketServer();
				const upgradeHandler = (
					request: Parameters<typeof handleUpgrade>[1],
					socket: Parameters<typeof handleUpgrade>[2],
					head: Parameters<typeof handleUpgrade>[3]
				) => {
					const url = new URL(request.url || '', `http://${request.headers.host}`);

					// Only handle exec endpoint
					if (url.pathname.match(/^\/api\/pods\/[^/]+\/[^/]+\/exec$/)) {
						handleUpgrade(wss, request, socket, head);
					}
				};

				httpServer.on('upgrade', upgradeHandler);
				httpServer.once('close', () => {
					httpServer.off('upgrade', upgradeHandler);
					void cleanupAllConnections();
					configuredHttpServers.delete(httpServer);
				});

				console.log('[Vite] WebSocket server configured for /api/pods/.../exec');
			} catch (err) {
				configuredHttpServers.delete(httpServer);
				console.error('[Vite] Failed to load WebSocket module:', err);
			}
		}
	};
}

export default defineConfig({
	define: {
		__APP_VERSION__: JSON.stringify(version)
	},
	plugins: [tailwindcss(), sveltekit(), webSocketPlugin()],
	ssr: {
		noExternal: ['lucide-svelte']
	},
	test: {
		expect: { requireAssertions: true },
		projects: [...browserProjects, serverProject]
	}
});
