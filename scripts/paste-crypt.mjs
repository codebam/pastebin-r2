#!/usr/bin/env node
// @ts-nocheck
// Tiny CLI around the same browser crypto core, mainly for curl-based usage
// and local testing.
//
//   node scripts/paste-crypt.mjs keygen
//   node scripts/paste-crypt.mjs encrypt file.txt > body.bin
//   node scripts/paste-crypt.mjs decrypt body.bin --key <key> > file.txt
//
// `encrypt` prints the generated key on stderr as `key=<b64url>` unless one is
// supplied with `--key`.
import { readFileSync, writeFileSync } from 'node:fs';
import { b64urlToKey, decrypt, encrypt, generateKey, keyToB64url } from '../src/crypto.client.mjs';

const args = process.argv.slice(2);
const command = args.shift();

function usage() {
	console.error(`usage:
  paste-crypt keygen
  paste-crypt encrypt <file|-> [--key <b64url>]
  paste-crypt decrypt <file|-> --key <b64url> [--out <file>]`);
	process.exit(2);
}

function readInput(path) {
	return path === '-' ? readFileSync(0) : readFileSync(path);
}

function writeOutput(data, outPath) {
	if (outPath) writeFileSync(outPath, data);
	else writeFileSync(1, data);
}

function takeOption(name) {
	const index = args.indexOf(name);
	if (index === -1) return null;
	const value = args[index + 1];
	if (value === undefined) usage();
	args.splice(index, 2);
	return value;
}

if (command === 'keygen') {
	console.log(keyToB64url(generateKey()));
	process.exit(0);
}

if (command === 'encrypt') {
	const outPath = takeOption('--out');
	const keyOption = takeOption('--key');
	const file = args.shift();
	if (!file || args.length) usage();
	const key = keyOption ? b64urlToKey(keyOption) : generateKey();
	const { container } = encrypt(new Uint8Array(readInput(file)), key);
	writeOutput(Buffer.from(container), outPath);
	if (!keyOption) console.error(`key=${keyToB64url(key)}`);
	process.exit(0);
}

if (command === 'decrypt') {
	const outPath = takeOption('--out');
	const keyOption = takeOption('--key');
	const file = args.shift();
	if (!file || !keyOption || args.length) usage();
	const plaintext = decrypt(new Uint8Array(readInput(file)), b64urlToKey(keyOption));
	writeOutput(Buffer.from(plaintext), outPath);
	process.exit(0);
}

usage();
