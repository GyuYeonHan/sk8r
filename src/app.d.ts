import type { AppPermission, AuthUser } from '$lib/types/auth';

// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	const __APP_VERSION__: string;

	namespace App {
		// interface Error {}
		interface Locals {
			user: AuthUser | null;
			isAdmin: boolean;
			permissions: Set<AppPermission>;
		}
		interface PageData {
			user: AuthUser | null;
			isAdmin: boolean;
			permissions: AppPermission[];
		}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
