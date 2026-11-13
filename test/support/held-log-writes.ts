import type { WriteStream } from "node:fs";

type WriteCallback = Parameters<WriteStream["_write"]>[2];

export function holdLogWrites(stream: WriteStream): () => void {
  let released = false;
  let pending: { write: () => void; callback: WriteCallback } | undefined;
  const hold = (write: () => void, callback: WriteCallback) => {
    if (released) write();
    else pending = { write, callback };
  };
  const write = stream._write.bind(stream);
  const writev = stream._writev?.bind(stream);
  const destroy = stream._destroy.bind(stream);
  stream._write = (chunk, encoding, callback) =>
    hold(() => write(chunk, encoding, callback), callback);
  if (writev)
    stream._writev = (chunks, callback) =>
      hold(() => writev(chunks, callback), callback);
  stream._destroy = (error, callback) => {
    const blocked = pending;
    pending = undefined;
    blocked?.callback(
      error ??
        Object.assign(new Error("Held log write cancelled."), {
          code: "ERR_STREAM_DESTROYED",
        }),
    );
    destroy(error, callback);
  };
  return () => {
    if (released) return;
    released = true;
    const blocked = pending;
    pending = undefined;
    blocked?.write();
  };
}
