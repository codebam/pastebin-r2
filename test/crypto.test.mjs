import test from 'node:test';
import assert from 'node:assert/strict';
import { MIN_CONTAINER_LENGTH, decrypt, encrypt, generateKey, keyFromHash, keyToB64url, b64urlToKey } from '../src/crypto.client.mjs';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

test('round-trips empty and small payloads', () => {
	for (const size of [0, 1, 15, 16, 17, 4096, 1024 * 1024]) {
		const plaintext = new Uint8Array(size);
		for (let i = 0; i < plaintext.length; i++) plaintext[i] = (i * 31 + 7) & 0xff;
		const { container, key } = encrypt(plaintext);
		assert.ok(container.length >= MIN_CONTAINER_LENGTH);
		assert.equal(container.length, plaintext.length + MIN_CONTAINER_LENGTH);
		assert.deepEqual(decrypt(container, key), plaintext);
	}
});

test('round-trips UTF-8 text', () => {
	const message = 'hello 🔒 pastebin\nwith two lines\n';
	const { container, key } = encrypt(textEncoder.encode(message));
	assert.equal(textDecoder.decode(decrypt(container, key)), message);
});

test('wrong key fails authentication', () => {
	const { container } = encrypt(textEncoder.encode('secret'));
	assert.throws(() => decrypt(container, generateKey()), /invalid tag|authentication/i);
});

test('tampered bytes fail authentication', () => {
	const { container, key } = encrypt(textEncoder.encode('secret'));
	for (const index of [0, 4, 5, 16, container.length - 1]) {
		const tampered = container.slice();
		tampered[index] ^= 0x01;
		assert.throws(() => decrypt(tampered, key), Error, `offset ${index}`);
	}
});

test('rejects malformed containers and keys', () => {
	assert.throws(() => decrypt(new Uint8Array(10), generateKey()), /payload/i);
	const { container } = encrypt(new Uint8Array([1]));
	assert.throws(() => decrypt(container, new Uint8Array(31)), /key/i);
	const badMagic = container.slice();
	badMagic[0] = 0;
	assert.throws(() => decrypt(badMagic, generateKey()), /not a pastebin-r2/i);
	const badVersion = container.slice();
	badVersion[4] = 0xff;
	assert.throws(() => decrypt(badVersion, generateKey()), /version/i);
});

test('base64url key encoding round-trips', () => {
	const key = generateKey();
	const encoded = keyToB64url(key);
	assert.match(encoded, /^[A-Za-z0-9_-]{43}$/);
	assert.deepEqual(b64urlToKey(encoded), key);
	assert.deepEqual(b64urlToKey(`#k=${encoded}`), key);
});

test('keyFromHash reads fragment and rejects missing/invalid keys', () => {
	const key = generateKey();
	const encoded = keyToB64url(key);
	assert.deepEqual(keyFromHash(`#k=${encoded}`), key);
	assert.equal(keyFromHash(''), null);
	assert.equal(keyFromHash('#other=1'), null);
	assert.throws(() => keyFromHash('#k=not-a-valid-key'), /key/i);
});
