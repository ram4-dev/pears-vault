/// <reference types="node" />
import { EventEmitter, once } from "node:events";
import type { Duplex } from "node:stream";

export const CONTROL_CHANNEL = 1;
export const REPLICATION_CHANNEL = 2;
export const MAX_FRAME_BYTES = 256 * 1024;

export interface RpcRequest {
	id: number;
	type: string;
	[key: string]: unknown;
}

export interface RpcResponse {
	id: number;
	ok: boolean;
	result?: unknown;
	error?: string;
}

export async function waitForOpen(
	stream: Duplex & { opened?: boolean },
): Promise<void> {
	if (stream.opened) return;
	await Promise.race([
		once(stream, "open").then(() => undefined),
		once(stream, "error").then(([error]) => Promise.reject(error)),
	]);
}

export async function readChannel(stream: Duplex): Promise<number> {
	stream.pause();
	return new Promise((resolve, reject) => {
		const cleanup = (): void => {
			stream.off("readable", onReadable);
			stream.off("error", onError);
			stream.off("end", onEnd);
		};
		const onError = (error: Error): void => {
			cleanup();
			reject(error);
		};
		const onEnd = (): void => {
			cleanup();
			reject(new Error("Connection ended before channel negotiation"));
		};
		const onReadable = (): void => {
			const chunk = stream.read() as Buffer | null;
			if (!chunk || chunk.length === 0) return;
			cleanup();
			if (chunk.length > 1) stream.unshift(chunk.subarray(1));
			resolve(chunk[0]);
		};
		stream.on("readable", onReadable);
		stream.once("error", onError);
		stream.once("end", onEnd);
		onReadable();
	});
}

export function selectChannel(stream: Duplex, channel: number): void {
	stream.write(Buffer.from([channel]));
}

function encodeFrame(value: unknown): Buffer {
	const frame = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
	if (frame.length > MAX_FRAME_BYTES)
		throw new Error("Protocol frame is too large");
	return frame;
}

class JsonLineDecoder extends EventEmitter {
	private buffer = Buffer.alloc(0);

	push(chunk: Buffer): void {
		this.buffer = Buffer.concat([this.buffer, chunk]);
		if (this.buffer.length > MAX_FRAME_BYTES) {
			this.emit("error", new Error("Protocol frame is too large"));
			return;
		}

		let newline = this.buffer.indexOf(10);
		while (newline !== -1) {
			const line = this.buffer.subarray(0, newline);
			this.buffer = this.buffer.subarray(newline + 1);
			if (line.length > 0) {
				try {
					this.emit("message", JSON.parse(line.toString("utf8")));
				} catch {
					this.emit("error", new Error("Invalid JSON protocol frame"));
					return;
				}
			}
			newline = this.buffer.indexOf(10);
		}
	}
}

export class RpcClient {
	private nextId = 1;
	private readonly pending = new Map<
		number,
		{ resolve: (value: unknown) => void; reject: (error: Error) => void }
	>();

	constructor(private readonly stream: Duplex) {
		const decoder = new JsonLineDecoder();
		stream.on("data", (chunk) => decoder.push(Buffer.from(chunk)));
		decoder.on("message", (message) => this.onMessage(message));
		decoder.on("error", (error) => stream.destroy(error as Error));
		stream.once("close", () =>
			this.rejectAll(new Error("Host connection closed")),
		);
		stream.once("error", (error) => this.rejectAll(error));
		stream.resume();
	}

	request(
		type: string,
		fields: Record<string, unknown> = {},
	): Promise<unknown> {
		const id = this.nextId++;
		const frame = encodeFrame({ id, type, ...fields });
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			this.stream.write(frame, (error) => {
				if (!error) return;
				this.pending.delete(id);
				reject(error);
			});
		});
	}

	close(): void {
		this.stream.end();
	}

	private onMessage(value: unknown): void {
		if (!value || typeof value !== "object") return;
		const response = value as RpcResponse;
		if (!Number.isInteger(response.id) || typeof response.ok !== "boolean")
			return;
		const pending = this.pending.get(response.id);
		if (!pending) return;
		this.pending.delete(response.id);
		if (response.ok) pending.resolve(response.result);
		else
			pending.reject(
				new Error(
					typeof response.error === "string"
						? response.error
						: "Host request failed",
				),
			);
	}

	private rejectAll(error: Error): void {
		for (const pending of this.pending.values()) pending.reject(error);
		this.pending.clear();
	}
}

export function serveRpc(
	stream: Duplex,
	handler: (request: RpcRequest) => Promise<unknown>,
): void {
	const decoder = new JsonLineDecoder();
	stream.on("data", (chunk) => decoder.push(Buffer.from(chunk)));
	decoder.on("error", (error) => stream.destroy(error as Error));
	decoder.on("message", async (value) => {
		if (!value || typeof value !== "object") {
			stream.destroy(new Error("Invalid RPC request"));
			return;
		}
		const request = value as RpcRequest;
		if (
			!Number.isInteger(request.id) ||
			request.id < 1 ||
			typeof request.type !== "string"
		) {
			stream.destroy(new Error("Invalid RPC request"));
			return;
		}
		try {
			const result = await handler(request);
			stream.write(encodeFrame({ id: request.id, ok: true, result }));
		} catch (error) {
			const message = error instanceof Error ? error.message : "Request failed";
			stream.write(encodeFrame({ id: request.id, ok: false, error: message }));
		}
	});
	stream.resume();
}
