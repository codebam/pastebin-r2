// @ts-nocheck
// ChaCha20-Poly1305 container used for encrypted pastes.
//
// Wire format (version 1):
//   offset 0  size 4   magic "PBR2"
//   offset 4  size 1   format version (0x01)
//   offset 5  size 12  random nonce
//   offset 17 size N   ChaCha20-Poly1305 ciphertext || 16-byte tag
//
// The key is a fresh random 32-byte value per paste. It is shared in the URL
// fragment as unpadded base64url, so it never reaches the server.
import { chacha20poly1305 } from '@noble/ciphers/chacha.js';

export const MAGIC = new Uint8Array([0x50, 0x42, 0x52, 0x32]); // "PBR2"
export const FORMAT_VERSION = 1;
export const HEADER_LENGTH = MAGIC.length + 1;
export const NONCE_LENGTH = 12;
export const KEY_LENGTH = 32;
export const TAG_LENGTH = 16;
export const MIN_CONTAINER_LENGTH = HEADER_LENGTH + NONCE_LENGTH + TAG_LENGTH;

function formatHeader() {
	const out = new Uint8Array(HEADER_LENGTH);
	out.set(MAGIC, 0);
	out[MAGIC.length] = FORMAT_VERSION;
	return out;
}

function concatBytes(parts) {
	let total = 0;
	for (const part of parts) total += part.length;
	const out = new Uint8Array(total);
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
}

function toBytes(value) {
	if (value instanceof Uint8Array) return value;
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
	throw new TypeError('expected bytes');
}

function randomBytes(length) {
	if (!globalThis.crypto || typeof globalThis.crypto.getRandomValues !== 'function') {
		throw new Error('secure random source unavailable');
	}
	return globalThis.crypto.getRandomValues(new Uint8Array(length));
}

export function generateKey() {
	return randomBytes(KEY_LENGTH);
}

// Returns { container, key }. Pass an existing key to encrypt with it.
export function encrypt(plaintext, key = generateKey()) {
	const message = toBytes(plaintext);
	if (toBytes(key).length !== KEY_LENGTH) throw new Error(`key must be ${KEY_LENGTH} bytes`);
	const hdr = formatHeader();
	const nonce = randomBytes(NONCE_LENGTH);
	const ciphertext = chacha20poly1305(key, nonce, hdr).encrypt(message);
	return { container: concatBytes([hdr, nonce, ciphertext]), key };
}

export function decrypt(container, key) {
	const payload = toBytes(container);
	const keyBytes = toBytes(key);
	if (keyBytes.length !== KEY_LENGTH) throw new Error(`key must be ${KEY_LENGTH} bytes`);
	if (payload.length < MIN_CONTAINER_LENGTH) throw new Error('not a pastebin-r2 encrypted payload');
	for (let i = 0; i < MAGIC.length; i++) {
		if (payload[i] !== MAGIC[i]) throw new Error('not a pastebin-r2 encrypted payload');
	}
	if (payload[MAGIC.length] !== FORMAT_VERSION) throw new Error('unsupported encryption format version');
	const hdr = payload.subarray(0, HEADER_LENGTH);
	const nonce = payload.subarray(HEADER_LENGTH, HEADER_LENGTH + NONCE_LENGTH);
	const ciphertext = payload.subarray(HEADER_LENGTH + NONCE_LENGTH);
	if (ciphertext.length < TAG_LENGTH) throw new Error('encrypted payload is truncated');
	// Throws "invalid tag" when the key is wrong or any byte was changed.
	return chacha20poly1305(keyBytes, nonce, hdr).decrypt(ciphertext);
}

export function keyToB64url(key) {
	const bytes = toBytes(key);
	if (bytes.length !== KEY_LENGTH) throw new Error(`key must be ${KEY_LENGTH} bytes`);
	let binary = '';
	for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlToKey(value) {
	if (typeof value !== 'string') throw new TypeError('key must be a string');
	const raw = value.trim().replace(/^#/, '').replace(/^k=/, '');
	const normalized = raw.replace(/-/g, '+').replace(/_/g, '/');
	const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
	const binary = atob(padded);
	if (binary.length !== KEY_LENGTH) throw new Error(`key must decode to ${KEY_LENGTH} bytes`);
	const out = new Uint8Array(KEY_LENGTH);
	for (let i = 0; i < KEY_LENGTH; i++) out[i] = binary.charCodeAt(i);
	return out;
}

// Extract a key from a location hash such as "#k=<base64url>".
export function keyFromHash(hash) {
	if (!hash) return null;
	const params = new URLSearchParams(hash.replace(/^#/, ''));
	const value = params.get('k');
	if (!value) return null;
	return b64urlToKey(value);
}
