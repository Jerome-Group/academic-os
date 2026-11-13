import type { WriteStream } from "node:fs";

type WriteCallback = Parameters<WriteStream["_write"]>[2];

export function delayLogWrites(stream: WriteStream, delayPerChunkMs = 4): void {
  const pending = new Map<NodeJS.Timeout, WriteCallback>();
  const cancelled = () =>
    Object.assign(new Error("Delayed log write cancelled."), {
      code: "ERR_STREAM_DESTROYED",
    });
  const schedule = (
    bytes: number,
    action: () => void,
    callback: WriteCallback,
  ) => {
    const timer = setTimeout(
      () => {
        pending.delete(timer);
        if (stream.destroyed) callback(cancelled());
        else action();
      },
      Math.ceil(bytes / 65536) * delayPerChunkMs,
    );
    pending.set(timer, callback);
  };
  const writeChunk = stream._write.bind(stream);
  const writeChunks = stream._writev?.bind(stream);
  const destroy = stream._destroy.bind(stream);
  stream._write = (chunk, encoding, callback) => {
    schedule(
      chunk.length,
      () => writeChunk(chunk, encoding, callback),
      callback,
    );
  };
  if (writeChunks)
    stream._writev = (chunks, callback) => {
      schedule(
        chunks.reduce((sum, entry) => sum + entry.chunk.length, 0),
        () => writeChunks(chunks, callback),
        callback,
      );
    };
  stream._destroy = (error, callback) => {
    const writes = [...pending];
    pending.clear();
    for (const [timer, done] of writes) {
      clearTimeout(timer);
      done(error ?? cancelled());
    }
    destroy(error, callback);
  };
}
