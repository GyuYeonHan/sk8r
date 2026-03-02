import crypto from 'node:crypto';

const KEY_BYTES = 32;
const IV_BYTES = 12;

let cachedKey: Buffer | null = null;

function readEncryptionKey(): Buffer {
	if (cachedKey) return cachedKey;

	const raw = process.env.APP_ENCRYPTION_KEY;
	if (!raw) {
		throw new Error(
			'APP_ENCRYPTION_KEY is required. Set a 32-byte base64 key in environment variables.'
		);
	}

	let key: Buffer;
	try {
		key = Buffer.from(raw, 'base64');
	} catch {
		throw new Error('APP_ENCRYPTION_KEY must be valid base64.');
	}

	if (key.length !== KEY_BYTES) {
		throw new Error('APP_ENCRYPTION_KEY must decode to exactly 32 bytes.');
	}

	cachedKey = key;
	return key;
}

export function assertEncryptionKeyConfigured(): void {
	readEncryptionKey();
}

export interface EncryptedValue {
	ciphertext: string;
	iv: string;
	tag: string;
}

export function encryptText(plainText: string): EncryptedValue {
	const key = readEncryptionKey();
	const iv = crypto.randomBytes(IV_BYTES);
	const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

	const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();

	return {
		ciphertext: encrypted.toString('base64'),
		iv: iv.toString('base64'),
		tag: tag.toString('base64')
	};
}

export function decryptText(ciphertext: string, iv: string, tag: string): string {
	const key = readEncryptionKey();

	try {
		const decipher = crypto.createDecipheriv(
			'aes-256-gcm',
			key,
			Buffer.from(iv, 'base64')
		);
		decipher.setAuthTag(Buffer.from(tag, 'base64'));

		const decrypted = Buffer.concat([
			decipher.update(Buffer.from(ciphertext, 'base64')),
			decipher.final()
		]);

		return decrypted.toString('utf8');
	} catch (error) {
		throw new Error('Failed to decrypt credential value.');
	}
}
