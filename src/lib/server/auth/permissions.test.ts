import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ADMIN_ROLE = process.env.KEYCLOAK_ADMIN_ROLE;

afterEach(() => {
	if (ORIGINAL_ADMIN_ROLE === undefined) {
		delete process.env.KEYCLOAK_ADMIN_ROLE;
	} else {
		process.env.KEYCLOAK_ADMIN_ROLE = ORIGINAL_ADMIN_ROLE;
	}
	vi.resetModules();
});

describe('auth permissions', () => {
	it('grants all permissions to admin role', async () => {
		process.env.KEYCLOAK_ADMIN_ROLE = 'admin';
		const { ALL_PERMISSIONS, mapRolesToPermissions, isAdminRole } = await import('./permissions');

		expect(isAdminRole(['admin'])).toBe(true);
		expect(new Set(mapRolesToPermissions(['admin']))).toEqual(new Set(ALL_PERMISSIONS));
	});

	it('grants default read/select permissions to regular users', async () => {
		process.env.KEYCLOAK_ADMIN_ROLE = 'admin';
		const { DEFAULT_USER_PERMISSIONS, mapRolesToPermissions, isAdminRole } =
			await import('./permissions');

		expect(isAdminRole(['viewer'])).toBe(false);
		expect(mapRolesToPermissions(['viewer'])).toEqual(DEFAULT_USER_PERMISSIONS);
		expect(mapRolesToPermissions([])).toEqual(DEFAULT_USER_PERMISSIONS);
	});

	it('respects a custom admin role name', async () => {
		process.env.KEYCLOAK_ADMIN_ROLE = 'platform-admin';
		const { resolveAdminRoleName, isAdminRole } = await import('./permissions');

		expect(resolveAdminRoleName()).toBe('platform-admin');
		expect(isAdminRole(['platform-admin'])).toBe(true);
		expect(isAdminRole(['admin'])).toBe(false);
	});
});
