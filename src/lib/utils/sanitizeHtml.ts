const UNSAFE_TAGS = new Set(['script', 'iframe', 'object', 'embed', 'link', 'style', 'meta']);
const URL_ATTRS = new Set(['href', 'src', 'xlink:href']);

function stripServerSide(html: string): string {
	return html
		.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
		.replace(/<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi, '')
		.replace(/<object[\s\S]*?>[\s\S]*?<\/object>/gi, '')
		.replace(/<embed[\s\S]*?>[\s\S]*?<\/embed>/gi, '')
		.replace(/\s+on[a-z]+\s*=\s*(['"]).*?\1/gi, '')
		.replace(/\s+on[a-z]+\s*=\s*[^\s>]+/gi, '')
		.replace(/\s(href|src|xlink:href)\s*=\s*(['"])\s*javascript:.*?\2/gi, '');
}

export function sanitizeHtml(input: string): string {
	if (!input) return '';

	// SSR-safe fallback sanitizer
	if (typeof window === 'undefined' || typeof DOMParser === 'undefined') {
		return stripServerSide(input);
	}

	const parser = new DOMParser();
	const doc = parser.parseFromString(input, 'text/html');
	const elements = doc.body.querySelectorAll('*');

	for (const element of elements) {
		const tag = element.tagName.toLowerCase();
		if (UNSAFE_TAGS.has(tag)) {
			element.remove();
			continue;
		}

		for (const attr of [...element.attributes]) {
			const name = attr.name.toLowerCase();
			const value = attr.value.trim();
			if (name.startsWith('on')) {
				element.removeAttribute(attr.name);
				continue;
			}
			if (URL_ATTRS.has(name) && /^javascript:/i.test(value)) {
				element.removeAttribute(attr.name);
			}
		}
	}

	return doc.body.innerHTML;
}

