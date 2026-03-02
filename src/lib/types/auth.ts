export type AppPermission =
	| 'resource:read'
	| 'resource:write'
	| 'cluster:select'
	| 'cluster:manage'
	| 'pod:exec'
	| 'debug:access'
	| 'test:access';

export interface AuthUser {
	sub: string;
	username: string;
	email?: string;
	name?: string;
	roles: string[];
}

export interface AuthSession {
	user: AuthUser;
	permissions: AppPermission[];
	isAdmin: boolean;
	issuedAt: number;
	expiresAt: number;
	idToken?: string;
}
