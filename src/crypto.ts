/// <reference types="node" />
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const VAULT_KEY_BYTES = 32;
export const GCM_IV_BYTES = 12;
export const GCM_TAG_BYTES = 16;
export const MAX_SECRET_BYTES = 64 * 1024;

export interface CiphertextEnvelope {
	v: 1;
	alg: "aes-256-gcm";
	iv: string;
	ciphertext: string;
	tag: string;
}

const HEX_RE = /^(?:[0-9a-f]{2})+$/i;

function isHexBytes(value: unknown, bytes?: number): value is string {
	if (typeof value !== "string" || !HEX_RE.test(value)) return false;
	return bytes === undefined || value.length === bytes * 2;
}

export function validateVaultKey(key: Buffer): void {
	if (!Buffer.isBuffer(key) || key.length !== VAULT_KEY_BYTES) {
		throw new Error("Vault key must be exactly 32 bytes");
	}
}

export function validateEnvelope(
	value: unknown,
): asserts value is CiphertextEnvelope {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Ciphertext envelope must be an object");
	}

	const envelope = value as Record<string, unknown>;
	const keys = Object.keys(envelope).sort().join(",");
	if (keys !== "alg,ciphertext,iv,tag,v")
		throw new Error("Ciphertext envelope has unexpected fields");
	if (envelope.v !== 1 || envelope.alg !== "aes-256-gcm")
		throw new Error("Unsupported ciphertext envelope");
	if (!isHexBytes(envelope.iv, GCM_IV_BYTES))
		throw new Error("Invalid AES-GCM IV");
	if (!isHexBytes(envelope.tag, GCM_TAG_BYTES))
		throw new Error("Invalid AES-GCM authentication tag");
	if (!isHexBytes(envelope.ciphertext)) throw new Error("Invalid ciphertext");
	if (envelope.ciphertext.length / 2 > MAX_SECRET_BYTES)
		throw new Error("Ciphertext is too large");
}

export function encryptSecret(
	name: string,
	plaintext: string,
	key: Buffer,
): CiphertextEnvelope {
	validateVaultKey(key);
	const input = Buffer.from(plaintext, "utf8");
	if (input.length === 0) throw new Error("Secret value cannot be empty");
	if (input.length > MAX_SECRET_BYTES)
		throw new Error(`Secret exceeds ${MAX_SECRET_BYTES} bytes`);

	const iv = randomBytes(GCM_IV_BYTES);
	const cipher = createCipheriv("aes-256-gcm", key, iv, {
		authTagLength: GCM_TAG_BYTES,
	});
	cipher.setAAD(Buffer.from(name, "utf8"));
	const ciphertext = Buffer.concat([cipher.update(input), cipher.final()]);

	return {
		v: 1,
		alg: "aes-256-gcm",
		iv: iv.toString("hex"),
		ciphertext: ciphertext.toString("hex"),
		tag: cipher.getAuthTag().toString("hex"),
	};
}

export function decryptSecret(
	name: string,
	envelope: CiphertextEnvelope,
	key: Buffer,
): string {
	validateVaultKey(key);
	validateEnvelope(envelope);

	const decipher = createDecipheriv(
		"aes-256-gcm",
		key,
		Buffer.from(envelope.iv, "hex"),
		{
			authTagLength: GCM_TAG_BYTES,
		},
	);
	decipher.setAAD(Buffer.from(name, "utf8"));
	decipher.setAuthTag(Buffer.from(envelope.tag, "hex"));
	const plaintext = Buffer.concat([
		decipher.update(Buffer.from(envelope.ciphertext, "hex")),
		decipher.final(),
	]);
	return plaintext.toString("utf8");
}
