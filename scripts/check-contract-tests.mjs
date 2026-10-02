import { spawnSync } from "node:child_process";

export async function runPassingTests(files) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(
    process.execPath,
    ["--test", "--test-concurrency=4", ...files],
    { env, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    await Promise.all([
      writeOutput(process.stdout, result.stdout ?? ""),
      writeOutput(process.stderr, result.stderr ?? ""),
    ]);
    process.exit(result.status ?? 1);
  }
  return result.stdout;
}

function writeOutput(stream, text) {
  return new Promise((resolve, reject) => {
    stream.write(text, (error) => (error ? reject(error) : resolve()));
  });
}
