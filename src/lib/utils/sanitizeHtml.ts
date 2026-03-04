import sanitizeHtmlLib from 'sanitize-html';

const SANITIZE_OPTIONS: sanitizeHtmlLib.IOptions = {
	allowedTags: sanitizeHtmlLib.defaults.allowedTags.concat([
		'img',
		'h1',
		'h2',
		'h3',
		'h4',
		'h5',
		'h6',
		'pre',
		'code',
		'span',
		'table',
		'thead',
		'tbody',
		'tr',
		'th',
		'td',
		'hr'
	]),
	allowedAttributes: {
		...sanitizeHtmlLib.defaults.allowedAttributes,
		a: ['href', 'name', 'target', 'rel'],
		img: ['src', 'srcset', 'alt', 'title', 'width', 'height', 'loading', 'decoding'],
		pre: ['class', 'style'],
		code: ['class', 'style'],
		span: ['class', 'style'],
		'*': ['class', 'id', 'title', 'lang', 'dir', 'aria-*']
	},
	allowedStyles: {
		pre: {
			color: [/^#(?:[0-9a-fA-F]{3}){1,2}$/],
			'background-color': [/^#(?:[0-9a-fA-F]{3}){1,2}$/]
		},
		code: {
			color: [/^#(?:[0-9a-fA-F]{3}){1,2}$/],
			'background-color': [/^#(?:[0-9a-fA-F]{3}){1,2}$/]
		},
		span: {
			color: [/^#(?:[0-9a-fA-F]{3}){1,2}$/],
			'background-color': [/^#(?:[0-9a-fA-F]{3}){1,2}$/],
			'font-style': [/^(normal|italic)$/],
			'font-weight': [/^(normal|bold|[1-9]00)$/],
			'text-decoration': [/^(none|underline|line-through)$/]
		}
	},
	allowedSchemes: ['http', 'https', 'mailto', 'tel'],
	allowedSchemesAppliedToAttributes: ['href', 'src'],
	allowProtocolRelative: false,
	disallowedTagsMode: 'discard',
	enforceHtmlBoundary: true
};

export function sanitizeHtml(input: string): string {
	if (!input) return '';
	return sanitizeHtmlLib(input, SANITIZE_OPTIONS);
}
