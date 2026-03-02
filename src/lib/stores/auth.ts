import { writable } from 'svelte/store';

const createAuthStore = () => {
	const { subscribe, set } = writable<string | null>(null);

	return {
		subscribe,
		// Backward-compatible no-op methods. Credentials are server-managed now.
		setToken: (_token: string) => set(null),
		clearToken: () => set(null),
		getCurrentToken: (): string | null => null,
		getCurrentServer: (): string | null => null,
		getSkipTLSVerify: (): boolean => true
	};
};

export const authToken = createAuthStore();
