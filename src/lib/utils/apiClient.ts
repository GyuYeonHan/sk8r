type Fetch = typeof fetch;

export const apiClient: Fetch = async (input, init) => {
	const headers = new Headers(init?.headers);

	const newInit: RequestInit = {
		...init,
		headers,
		credentials: 'same-origin'
	};

	return fetch(input, newInit);
};
