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

	let { children } = $props();
	
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

				if (!hasCustomClusters) {
					const serverInput = prompt('Please enter your Kubernetes server address:\n(hostname/IP or full URL like https://kubernetes.example.com:6443)');
					if (!serverInput) return;

					const token = prompt('Please enter your Kubernetes bearer token:');
					if (!token) return;

					try {
						let normalizedServer = serverInput.trim();
						if (!normalizedServer.startsWith('http://') && !normalizedServer.startsWith('https://')) {
							const hasPort = /:\d+$/.test(normalizedServer);
							normalizedServer = hasPort ? `https://${normalizedServer}` : `https://${normalizedServer}:6443`;
						} else if (normalizedServer.startsWith('http://')) {
							normalizedServer = normalizedServer.replace('http://', 'https://');
						}
						normalizedServer = normalizedServer.replace(/\/+$/, '');

						const newCluster = await clusterStore.addCluster(normalizedServer, token);
						await clusterStore.switchToCustomCluster(newCluster.id);
					} catch (err) {
						console.error('Failed to add cluster:', err);
						alert(`Failed to add cluster: ${err instanceof Error ? err.message : 'Unknown error'}`);
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
	<Sidebar />
	<main class="flex-1 overflow-auto dark:text-slate-100">
		<div class={isPatternPage ? '' : 'p-6'}>
			{@render children()}
		</div>
	</main>
	
	<!-- Global Search -->
	<GlobalSearch isOpen={searchOpen} onClose={closeSearch} />
</div>
