import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import filesystem, { mkdir, readFile, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { sha256 } from "../../src/checksum.js";
import { writtenControlPaths } from "../../src/conformance/control-paths.js";
import { appendProvedRegisterLines } from "../../src/curation/append-proved-register-lines.js";
import { openCurationRegisterJournal } from "../../src/curation/curation-register-journal.js";
import { journalFixture } from "../support/journal-process.js";

test("a confirmed append survives a competing writer that captured the same final prefix", async (t) => {
  const root = await journalFixture(t, "curation-final-prefix");
  const stateRoot = join(root, "state");
  const moduleRoot = join(root, "mount", "ZZ9999");
  const target = join(moduleRoot, writtenControlPaths.curationRegister);
  const prefix = '{"event":"prefix"}\n';
  await mkdir(dirname(target), { recursive: true });
  await mkdir(stateRoot);
  await writeFile(target, prefix);
  const context = new AsyncLocalStorage<string>();
  const reads = new Map<string, number>();
  const staged = new Set<string>();
  const barriers = new Map(
    ["A", "B"].map((label) => [
      label,
      {
        reached: Promise.withResolvers<void>(),
        release: Promise.withResolvers<void>(),
      },
    ]),
  );
  const originalRead = filesystem.readFile;
  const originalOpen = filesystem.open;
  filesystem.open = async (...args) => {
    const file = await originalOpen(...args);
    const label = context.getStore();
    if (String(args[0]).startsWith(`${target}.`) && label !== undefined)
      staged.add(label);
    return file;
  };
  filesystem.readFile = new Proxy(originalRead, {
    async apply(read, receiver, args) {
      const bytes = await Reflect.apply(read, receiver, args);
      const label = context.getStore();
      if (String(args[0]) === target && label !== undefined) {
        const number = (reads.get(label) ?? 0) + 1;
        reads.set(label, number);
        if (staged.delete(label)) {
          const barrier = barriers.get(label);
          assert.ok(barrier);
          barrier.reached.resolve();
          await barrier.release.promise;
        }
      }
      return bytes;
    },
  });
  syncBuiltinESMExports();
  const append = (label: string) =>
    context.run(label, () => {
      const input = {
        stateRoot,
        pending: [
          {
            module: "ZZ9999",
            semester: "Y9S9",
            observedSha256: sha256(prefix),
            sources: [],
            artifacts: [],
            lines: [JSON.stringify({ event: label })],
          },
        ],
        roots: {
          driveMount: root,
          moduleRoots: new Map([["ZZ9999", moduleRoot]]),
        },
        journal: () =>
          openCurationRegisterJournal({ stateRoot, kind: "curation-identity" }),
      };
      return appendProvedRegisterLines(input);
    });
  const a = barriers.get("A");
  const b = barriers.get("B");
  assert.ok(a);
  assert.ok(b);
  const first = append("A");
  let second: ReturnType<typeof append> | undefined;
  try {
    await a.reached.promise;
    second = append("B");
    await Promise.race([second, b.reached.promise]);
    a.release.resolve();
    const firstResult = await first;
    b.release.resolve();
    const secondResult = await second;
    const contents = await originalRead(target, "utf8");
    await writeFile(
      join(root, "readback.json"),
      JSON.stringify(
        { firstResult, secondResult, contents, reads: [...reads] },
        null,
        2,
      ),
    );
    assert.equal(firstResult.appended, 1);
    assert.ok(contents.startsWith(prefix));
    for (const [label, result] of [
      ["A", firstResult],
      ["B", secondResult],
    ] as const) {
      if (result.appended > 0)
        assert.ok(
          contents.includes(JSON.stringify({ event: label })),
          `confirmed append ${label} must remain in the register, got ${JSON.stringify(contents)}`,
        );
    }
  } finally {
    a.release.resolve();
    b.release.resolve();
    await Promise.allSettled([
      first,
      ...(second === undefined ? [] : [second]),
    ]);
    filesystem.readFile = originalRead;
    filesystem.open = originalOpen;
    syncBuiltinESMExports();
  }
});
