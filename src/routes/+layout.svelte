<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import GlobalSearch from '$lib/components/GlobalSearch.svelte';
	import { onMount } from 'svelte';
	import { clusterStore } from '$lib/stores/cluster';
	import { darkMode } from '$lib/stores/darkMode';
	import { get } from 'svelte/store';
	import { browser } from '$app/environment';
	import { page } from '$app/stores';
	import type { AuthUser } from '$lib/types/auth';

	interface Props {
		children: import('svelte').Snippet;
		data: {
			user: AuthUser | null;
			isAdmin: boolean;
		};
	}

	let { children, data }: Props = $props();

	// Check if we're on a patterns page (no padding needed)
	let isPatternPage = $derived($page.url.pathname.startsWith('/patterns'));
	let searchOpen = $state(false);

	onMount(() => {
		// Initialize dark mode on mount
		darkMode.initialize();

		function handleKeydown(event: KeyboardEvent) {
			// Ctrl+K or Cmd+K to open search
			if ((event.ctrlKey || event.metaKey) && event.key === 'k') {
				event.preventDefault();
				searchOpen = true;
			}
		}

		document.addEventListener('keydown', handleKeydown);

		if (browser) {
			const bootstrapClusters = async () => {
				try {
					await clusterStore.fetchContexts();
				} catch (err) {
					console.warn('Failed to fetch clusters:', err);
				}

				const clusterState = get(clusterStore);
				const hasCustomClusters = clusterState.customClusters.length > 0;

				if (!hasCustomClusters && data.isAdmin) {
					const serverInput = prompt(
						'Please enter your Kubernetes server address:\n(hostname/IP or full URL like https://kubernetes.example.com:6443)'
					);
					if (!serverInput) return;

					const token = prompt('Please enter your Kubernetes bearer token:');
					if (!token) return;

					try {
						let normalizedServer = serverInput.trim();
						if (
							!normalizedServer.startsWith('http://') &&
							!normalizedServer.startsWith('https://')
						) {
							const hasPort = /:\d+$/.test(normalizedServer);
							normalizedServer = hasPort
								? `https://${normalizedServer}`
								: `https://${normalizedServer}:6443`;
						} else if (normalizedServer.startsWith('http://')) {
							normalizedServer = normalizedServer.replace('http://', 'https://');
						}
						normalizedServer = normalizedServer.replace(/\/+$/, '');

						const newCluster = await clusterStore.addCluster(normalizedServer, token);
						await clusterStore.switchToCustomCluster(newCluster.id);
					} catch (err) {
						console.error('Failed to add cluster:', err);
						alert(
							`Failed to add cluster: ${err instanceof Error ? err.message : 'Unknown error'}`
						);
					}
				}
			};

			bootstrapClusters();
		}

		return () => {
			document.removeEventListener('keydown', handleKeydown);
		};
	});

	function closeSearch() {
		searchOpen = false;
	}
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="flex h-screen bg-gray-50 dark:bg-slate-900 transition-colors duration-200">
	<Sidebar isAdmin={data.isAdmin} user={data.user} />
	<main class="flex-1 overflow-auto dark:text-slate-100">
		<div class="flex items-center justify-end px-6 py-3 border-b border-gray-200 dark:border-slate-700 bg-white/80 dark:bg-slate-800/80 backdrop-blur">
			<div class="flex items-center gap-3">
				<div class="text-sm text-gray-700 dark:text-slate-300">
					<span class="font-medium">{data.user?.name || data.user?.username}</span>
					<span class="ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium {data.isAdmin ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'}">
						{data.isAdmin ? 'Admin' : 'User'}
					</span>
				</div>
				<form method="POST" action="/auth/logout">
					<button
						type="submit"
						class="px-3 py-1.5 text-xs font-medium rounded-md bg-gray-900 text-white hover:bg-gray-700 dark:bg-slate-600 dark:hover:bg-slate-500 transition-colors"
					>
						Logout
					</button>
				</form>
			</div>
		</div>
		<div class={isPatternPage ? '' : 'p-6'}>
			{@render children()}
		</div>
	</main>
	
	<!-- Global Search -->
	<GlobalSearch isOpen={searchOpen} onClose={closeSearch} />
</div>
