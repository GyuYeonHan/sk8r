import crypto from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_KEY = process.env.APP_ENCRYPTION_KEY;

function randomKeyBase64(): string {
	return crypto.randomBytes(32).toString('base64');
}

afterEach(() => {
	if (ORIGINAL_KEY === undefined) {
		delete process.env.APP_ENCRYPTION_KEY;
	} else {
		process.env.APP_ENCRYPTION_KEY = ORIGINAL_KEY;
	}
	vi.resetModules();
});

describe('credentialCrypto', () => {
	it('encrypts and decrypts text round-trip', async () => {
		process.env.APP_ENCRYPTION_KEY = randomKeyBase64();
		const { encryptText, decryptText } = await import('./credentialCrypto');

		const encrypted = encryptText('super-secret-token');
		const decrypted = decryptText(encrypted.ciphertext, encrypted.iv, encrypted.tag);

		expect(decrypted).toBe('super-secret-token');
	});

	it('throws when APP_ENCRYPTION_KEY is not set', async () => {
		delete process.env.APP_ENCRYPTION_KEY;
		const { assertEncryptionKeyConfigured } = await import('./credentialCrypto');

		expect(() => assertEncryptionKeyConfigured()).toThrow(/APP_ENCRYPTION_KEY is required/);
	});

	it('fails decryption when auth tag is tampered', async () => {
		process.env.APP_ENCRYPTION_KEY = randomKeyBase64();
		const { encryptText, decryptText } = await import('./credentialCrypto');

		const encrypted = encryptText('cluster-token');
		const tamperedTag = `${encrypted.tag.slice(0, -2)}AA`;

		expect(() => decryptText(encrypted.ciphertext, encrypted.iv, tamperedTag)).toThrow(
			'Failed to decrypt credential value.'
		);
	});
});
