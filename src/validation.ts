/// <reference types="node" />
import type { Buffer } from "node:buffer";
import b4a from "b4a";

export const PUBLIC_KEY_BYTES = 32;
export const MAX_NAME_LENGTH = 128;
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const HEX_RE = /^[0-9a-f]+$/i;

export function validateSecretName(name: unknown): asserts name is string {
	if (
		typeof name !== "string" ||
		name.length === 0 ||
		name.length > MAX_NAME_LENGTH ||
		!NAME_RE.test(name)
	) {
		throw new Error(
			"Secret name must be 1-128 characters using letters, numbers, dot, underscore, or dash",
		);
	}
}

export function parsePublicKey(value: unknown): Buffer {
	if (
		typeof value !== "string" ||
		value.length !== PUBLIC_KEY_BYTES * 2 ||
		!HEX_RE.test(value)
	) {
		throw new Error("Public key must be exactly 64 hexadecimal characters");
	}
	return b4a.from(value, "hex");
}

export interface BootstrapNode {
	host: string;
	port: number;
}

export function parseBootstrap(value?: string): BootstrapNode[] | undefined {
	if (!value) return undefined;
	const nodes = value.split(",").map((entry) => {
		const separator = entry.lastIndexOf(":");
		if (separator <= 0) throw new Error(`Invalid bootstrap address: ${entry}`);
		const host = entry.slice(0, separator);
		const port = Number(entry.slice(separator + 1));
		if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
			throw new Error(`Invalid bootstrap address: ${entry}`);
		}
		return { host, port };
	});
	if (nodes.length === 0)
		throw new Error("At least one bootstrap node is required");
	return nodes;
}
