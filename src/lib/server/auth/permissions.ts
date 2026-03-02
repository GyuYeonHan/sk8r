import type { AppPermission } from '$lib/types/auth';

export const ALL_PERMISSIONS: AppPermission[] = [
	'resource:read',
	'resource:write',
	'cluster:select',
	'cluster:manage',
	'pod:exec',
	'debug:access',
	'test:access'
];

export const DEFAULT_USER_PERMISSIONS: AppPermission[] = ['resource:read', 'cluster:select'];

export function resolveAdminRoleName(): string {
	const configured = process.env.KEYCLOAK_ADMIN_ROLE?.trim();
	return configured || 'admin';
}

export function isAdminRole(roles: string[], adminRole = resolveAdminRoleName()): boolean {
	if (!roles || roles.length === 0) return false;
	return roles.includes(adminRole);
}

export function mapRolesToPermissions(
	roles: string[],
	adminRole = resolveAdminRoleName()
): AppPermission[] {
	if (isAdminRole(roles, adminRole)) {
		return [...ALL_PERMISSIONS];
	}

	return [...DEFAULT_USER_PERMISSIONS];
}

export function toPermissionSet(
	permissions: Iterable<AppPermission> | undefined | null
): Set<AppPermission> {
	if (!permissions) return new Set<AppPermission>();
	return new Set<AppPermission>(permissions);
}

export function hasPermission(
	permissions: Set<AppPermission> | AppPermission[] | undefined | null,
	permission: AppPermission
): boolean {
	if (!permissions) return false;
	if (permissions instanceof Set) {
		return permissions.has(permission);
	}

	return permissions.includes(permission);
}
