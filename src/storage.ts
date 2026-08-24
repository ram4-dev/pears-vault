/// <reference types="node" />
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import b4a from "b4a";
import DHT from "hyperdht";
import { VAULT_KEY_BYTES, validateVaultKey } from "./crypto.js";

export interface DhtKeyPair {
	publicKey: Buffer;
	secretKey: Buffer;
}

async function writePrivateFile(path: string, value: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, value, { encoding: "utf8", mode: 0o600 });
	await chmod(path, 0o600);
}

export async function loadOrCreateDhtKeyPair(
	dataDir: string,
): Promise<DhtKeyPair> {
	const path = join(dataDir, "dht-keypair.json");
	try {
		const raw = JSON.parse(await readFile(path, "utf8")) as Record<
			string,
			unknown
		>;
		if (
			typeof raw.publicKey !== "string" ||
			typeof raw.secretKey !== "string"
		) {
			throw new Error("Stored DHT keypair is malformed");
		}
		const publicKey = b4a.from(raw.publicKey, "hex");
		const secretKey = b4a.from(raw.secretKey, "hex");
		if (publicKey.length !== 32 || secretKey.length !== 64)
			throw new Error("Stored DHT keypair has invalid lengths");
		return { publicKey, secretKey };
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}

	const keyPair = DHT.keyPair() as DhtKeyPair;
	await writePrivateFile(
		path,
		JSON.stringify(
			{
				publicKey: b4a.toString(keyPair.publicKey, "hex"),
				secretKey: b4a.toString(keyPair.secretKey, "hex"),
			},
			null,
			2,
		),
	);
	return keyPair;
}

export async function loadOrCreateVaultKey(dataDir: string): Promise<Buffer> {
	const path = join(dataDir, "vault-key");
	try {
		const key = Buffer.from((await readFile(path, "utf8")).trim(), "hex");
		validateVaultKey(key);
		return key;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}

	const key = randomBytes(VAULT_KEY_BYTES);
	await writePrivateFile(path, key.toString("hex"));
	return key;
}

export async function ensureDataDir(dataDir: string): Promise<void> {
	await mkdir(dataDir, { recursive: true, mode: 0o700 });
	await chmod(dataDir, 0o700);
}
