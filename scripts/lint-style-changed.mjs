import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const SUPPORTED_EXTENSIONS = new Set([
	'.js',
	'.cjs',
	'.mjs',
	'.ts',
	'.cts',
	'.mts',
	'.svelte',
	'.json',
	'.css',
	'.scss',
	'.html',
	'.md',
	'.yml',
	'.yaml'
]);

const ALLOWED_ROOT_FILES = new Set([
	'server.js',
	'websocket.js',
	'vite.config.ts',
	'eslint.config.js',
	'package.json',
	'.prettierrc'
]);

function isInStyleScope(file) {
	if (file.startsWith('src/')) return true;
	if (file.startsWith('scripts/')) return true;
	return ALLOWED_ROOT_FILES.has(file);
}

function tryGit(args) {
	try {
		return execFileSync('git', args, { encoding: 'utf8' }).trim();
	} catch {
		return '';
	}
}

function resolveBaseRef() {
	const fromEnv = process.env.PRETTIER_BASE_REF?.trim();
	if (fromEnv) {
		return fromEnv;
	}

	for (const candidate of ['origin/main', 'origin/master']) {
		const exists = tryGit(['rev-parse', '--verify', candidate]);
		if (exists) return candidate;
	}

	return 'HEAD~1';
}

const baseRef = resolveBaseRef();
const mergeBase = tryGit(['merge-base', 'HEAD', baseRef]) || tryGit(['rev-parse', 'HEAD~1']);

if (!mergeBase) {
	console.log('[lint:style] Skipping: unable to resolve merge base.');
	process.exit(0);
}

const diffOutput = tryGit(['diff', '--name-only', '--diff-filter=ACMRTUXB', mergeBase]);
const changedFiles = diffOutput
	.split('\n')
	.map((file) => file.trim())
	.filter(Boolean)
	.filter((file) => isInStyleScope(file))
	.filter((file) => SUPPORTED_EXTENSIONS.has(path.extname(file).toLowerCase()))
	.filter((file) => existsSync(file));

if (changedFiles.length === 0) {
	console.log('[lint:style] No changed style-checkable files.');
	process.exit(0);
}

const result = spawnSync('npx', ['prettier', '--check', ...changedFiles], { stdio: 'inherit' });
process.exit(result.status ?? 1);
