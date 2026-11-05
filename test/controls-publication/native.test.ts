import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  truncateSync,
  utimesSync,
  chmodSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, describe, it } from "node:test";
import { PublicationStore } from "../../src/controls-publication/store.js";
import { PublicationFailure } from "../../src/controls-publication/failure.js";
import {
  encodePublication,
  sha256,
} from "../../src/controls-publication/codec.js";
import type {
  JournalEvent,
  PublicationRecord,
} from "../../src/controls-publication/generated/publication-contract-1.js";
import { withJournalMutationOwner } from "../../src/journal-mutation-owner.js";
import type { ObjectIdentity } from "../../src/controls-publication/generated/publication-contract-1.js";
import type {
  DirectoryHandle,
  MutationInterval,
  NativeResult,
  PublicationNative,
  RawName,
  RegularHandle,
  ValidatedAccountAnchor,
} from "../../src/controls-publication/native-contract.js";
import {
  isPublicationNative,
  loadPublicationNative,
} from "../../src/controls-publication/native/index.js";

interface FixtureNative extends PublicationNative {
  setFixtureCheckpoint(callback: ((edge: string) => void) | undefined): void;
}
function isFixtureNative(value: unknown): value is FixtureNative {
  return (
    isPublicationNative(value) &&
    "setFixtureCheckpoint" in value &&
    typeof value.setFixtureCheckpoint === "function"
  );
}
function ok<T>(result: NativeResult<T>): T {
  if (result.kind !== "ok") throw new Error(result.code);
  return result.value;
}
function failed(result: NativeResult<unknown>, code?: string): void {
  assert.equal(result.kind, "native-failure");
  if (result.kind === "native-failure" && code !== undefined)
    assert.equal(result.code, code);
}
interface Fixture {
  root: string;
  native: FixtureNative;
  anchor: ValidatedAccountAnchor;
  interval: MutationInterval;
  handles: (DirectoryHandle | RegularHandle)[];
  addon: string;
}
let fixture: Fixture | undefined;
function f(): Fixture {
  assert.ok(fixture);
  return fixture;
}
function name(value: string | Uint8Array): RawName {
  return ok(
    f().native.component(
      typeof value === "string" ? Buffer.from(value) : value,
    ),
  );
}
function directory(
  value: string,
  parent = f().anchor.directory,
): DirectoryHandle {
  const target = ok(
    f().native.createDirectoryExclusive({
      interval: f().interval,
      parent,
      name: name(value),
    }),
  );
  f().handles.push(target);
  return target;
}
function file(
  value: string | Uint8Array,
  bytes = Buffer.alloc(0),
  parent = f().anchor.directory,
): RegularHandle {
  const target = ok(
    f().native.createRegularExclusive({
      interval: f().interval,
      parent,
      name: name(value),
    }),
  );
  f().handles.push(target);
  ok(
    f().native.writeExact({
      interval: f().interval,
      file: target,
      bytes,
      expectedObject: identity(target),
    }),
  );
  return target;
}
function identity(value: DirectoryHandle | RegularHandle): ObjectIdentity {
  return ok(f().native.observe(value)).object;
}
function exclusions(paths = [process.cwd()]): void {
  ok(
    f().native.observeExclusionRoots({
      anchor: f().anchor,
      requiredRepositoryAndSourcePaths: paths.map((path) => Buffer.from(path)),
    }),
  );
}

describe("same-process publication native boundary", {
  skip: process.platform !== "darwin",
}, () => {
  before(() => {
    const root = realpathSync(
      mkdtempSync(join(tmpdir(), "academic-os-publication-native-")),
    );
    const anchorPath = join(root, "anchor"),
      addon = join(root, "fixture.node");
    mkdirSync(anchorPath, { mode: 0o700 });
    mkdirSync(join(root, "account"), { mode: 0o700 });
    const build = execFileSync(
      process.execPath,
      [
        "scripts/build-control-publication-native.mjs",
        "--fixture-anchor",
        anchorPath,
        "--output",
        addon,
      ],
      { encoding: "utf8", timeout: 30000 },
    );
    writeFileSync(join(root, "build-output.txt"), build);
    execFileSync(
      "xcrun",
      [
        "clang++",
        "-std=c++17",
        "-framework",
        "CoreFoundation",
        `-DAOS_ALIAS_FIXTURE_ROOT=${JSON.stringify(root)}`,
        "test/controls-publication/alias-fixture.cc",
        "-o",
        join(root, "alias-fixture"),
      ],
      { encoding: "utf8", timeout: 30000 },
    );
    const native: unknown = createRequire(import.meta.url)(addon);
    assert.ok(isFixtureNative(native));
    const anchor = ok(native.resolveAccountAnchor());
    assert.equal(anchor.canonicalAnchorPath, anchorPath);
    const observed = ok(
      native.observeExclusionRoots({
        anchor,
        requiredRepositoryAndSourcePaths: [Buffer.from(process.cwd())],
      }),
    );
    ok(
      native.requirePrivateLocalNonoverlap({
        anchor,
        namespace: anchor.directory,
        exclusions: observed,
      }),
    );
    const interval = ok(native.beginIntervalUnderHeldGate(anchor));
    fixture = { root, native, anchor, interval, handles: [], addon };
  });
  after((context) => {
    if (fixture === undefined) return;
    fixture.native.setFixtureCheckpoint(undefined);
    ok(fixture.native.expireAndDrain(fixture.interval));
    for (const handle of fixture.handles.reverse())
      ok(fixture.native.close(handle));
    ok(fixture.native.close(fixture.anchor.directory));
    writeFileSync(
      join(fixture.root, "observations.json"),
      JSON.stringify(
        {
          fixture: fixture.root,
          sourceHead: execFileSync("git", ["rev-parse", "HEAD"], {
            encoding: "utf8",
          }).trim(),
          host: fixture.anchor.host,
          fixtureBinarySha256: createHash("sha256")
            .update(readFileSync(fixture.addon))
            .digest("hex"),
          ownedHandlesClosed: fixture.handles.length + 1,
          artifacts: readdirSync(join(fixture.root, "anchor")),
        },
        null,
        2,
      ),
    );
    context.diagnostic(`Retained native fixture ${fixture.root}`);
  });
  it("resolves the actual account under changed HOME/XDG/cwd without publisher writes", () => {
    execFileSync(
      process.execPath,
      ["scripts/build-control-publication-native.mjs"],
      { encoding: "utf8", timeout: 30000 },
    );
    const addon = resolve(
      "dist/src/controls-publication/native/publication-native.node",
    );
    const source = `const n=require(${JSON.stringify(addon)});const a=n.resolveAccountAnchor();if(a.kind!=="ok")throw Error(JSON.stringify(a));const output={host:a.value.host,path:a.value.canonicalAnchorPath,rootOwned:a.value.ancestry.some(c=>c.metadata.uid===0),fixtureHook:typeof n.setFixtureCheckpoint};n.close(a.value.directory);process.stdout.write(JSON.stringify(output));`;
    const normal = execFileSync(process.execPath, ["-e", source], {
      encoding: "utf8",
    });
    const changed = execFileSync(process.execPath, ["-e", source], {
      encoding: "utf8",
      cwd: f().root,
      env: {
        ...process.env,
        HOME: f().root,
        XDG_STATE_HOME: join(f().root, "xdg"),
        ACADEMIC_OS_STATE_ROOT: f().root,
      },
    });
    assert.equal(changed, normal);
    const result: unknown = JSON.parse(normal);
    assert.ok(
      typeof result === "object" &&
        result !== null &&
        "rootOwned" in result &&
        result.rootOwned === true &&
        "fixtureHook" in result &&
        result.fixtureHook === "undefined",
    );
    assert.equal(loadPublicationNative().kind, "ok");
  });
  it("refuses fixture addons in production loading and protects production build output", () => {
    const productionPath = resolve(
      "dist/src/controls-publication/native/publication-native.node",
    );
    const before = readFileSync(productionPath);
    const build = spawnSync(
      process.execPath,
      [
        "scripts/build-control-publication-native.mjs",
        "--fixture-anchor",
        join(f().root, "anchor"),
        "--output",
        productionPath,
      ],
      { encoding: "utf8" },
    );
    assert.notEqual(build.status, 0);
    assert.match(
      build.stderr,
      /Fixture addons must stay outside the production dist directory/,
    );
    assert.deepEqual(readFileSync(productionPath), before);
    const loaderRoot = join(f().root, "fixture-as-production");
    mkdirSync(loaderRoot, { mode: 0o700 });
    copyFileSync(
      resolve("dist/src/controls-publication/native/index.js"),
      join(loaderRoot, "index.mjs"),
    );
    copyFileSync(f().addon, join(loaderRoot, "publication-native.node"));
    const script = `import {loadPublicationNative} from ${JSON.stringify(pathToFileURL(join(loaderRoot, "index.mjs")).href)}; process.stdout.write(JSON.stringify(loadPublicationNative()));`;
    const output = execFileSync(
      process.execPath,
      ["--input-type=module", "-e", script],
      { encoding: "utf8" },
    );
    assert.deepEqual(JSON.parse(output), {
      kind: "native-failure",
      code: "unsupported-host",
      operation: "native-load",
    });
    renameSync(
      join(loaderRoot, "publication-native.node"),
      join(loaderRoot, "retained-fixture.node"),
    );
    const missing = execFileSync(
      process.execPath,
      ["--input-type=module", "-e", script],
      { encoding: "utf8" },
    );
    assert.equal(missing, output);
  });
  it("runtime-tags components and handles and retains non-UTF8 raw bytes", () => {
    for (const raw of ["", ".", "..", "a/b", "a\0b"])
      failed(f().native.component(Buffer.from(raw)), "unsafe-ancestry");
    const raw = Buffer.from([0x66, 0x80, 0xff]);
    assert.deepEqual(Buffer.from(f().native.componentBytes(name(raw))), raw);
    failed(
      f().native.createRegularExclusive({
        interval: f().interval,
        parent: f().anchor.directory,
        name: name(raw),
      }),
      "unsupported-host",
    );
    const target = file("raw-component", Buffer.from("raw"));
    assert.equal(ok(f().native.observe(target)).metadata.mode, 0o600);
    assert.throws(
      () => Reflect.apply(f().native.componentBytes, undefined, [{}]),
      /Invalid native raw component/,
    );
    failed(
      Reflect.apply(f().native.observe, undefined, [{}]),
      "unsafe-ancestry",
    );
    failed(
      Reflect.apply(f().native.beginIntervalUnderHeldGate, undefined, [
        { ...f().anchor },
      ]),
      "unsafe-ancestry",
    );
  });
  it("writes, truncates, bounds and appends exact bytes on the claimed object", () => {
    const target = file("exact", Buffer.from("long first value")),
      object = identity(target);
    ok(
      f().native.writeExact({
        interval: f().interval,
        file: target,
        bytes: Buffer.from("one"),
        expectedObject: object,
      }),
    );
    assert.equal(
      Buffer.from(
        ok(
          f().native.readBounded({
            file: target,
            maximumBytes: 3,
            exactLength: 3,
          }),
        ),
      ).toString(),
      "one",
    );
    failed(f().native.readBounded({ file: target, maximumBytes: 2 }));
    failed(
      f().native.readBounded({
        file: target,
        maximumBytes: 100,
        exactLength: 0,
      }),
    );
    failed(
      f().native.appendExact({
        interval: f().interval,
        file: target,
        bytes: Buffer.from("!"),
        expectedObject: object,
        expectedLength: 2,
      }),
      "identity-changed",
    );
    ok(
      f().native.appendExact({
        interval: f().interval,
        file: target,
        bytes: Buffer.from("!"),
        expectedObject: object,
        expectedLength: 3,
      }),
    );
    assert.equal(
      Buffer.from(
        ok(f().native.readBounded({ file: target, maximumBytes: 100 })),
      ).toString(),
      "one!",
    );
    failed(
      f().native.writeExact({
        interval: f().interval,
        file: target,
        bytes: Buffer.from("wrong"),
        expectedObject: { ...object, inode: "1" },
      }),
      "identity-changed",
    );
    ok(
      f().native.writeExact({
        interval: f().interval,
        file: target,
        bytes: Buffer.alloc(0),
        expectedObject: object,
      }),
    );
    assert.equal(
      ok(
        f().native.readBounded({
          file: target,
          maximumBytes: 0,
          exactLength: 0,
        }),
      ).length,
      0,
    );
    assert.equal(statSync(join(f().root, "anchor/exact")).size, 0);
  });
  it("promotes exclusively and preserves object identity and descendant linkage", () => {
    const stage = directory("stage"),
      retained = file("retained", Buffer.from("retained"), stage),
      object = identity(stage);
    ok(
      f().native.promoteExclusive({
        interval: f().interval,
        sourceParent: f().anchor.directory,
        sourceName: name("stage"),
        destinationParent: f().anchor.directory,
        destinationName: name("generation"),
        expectedObject: object,
      }),
    );
    assert.deepEqual(identity(stage), object);
    assert.equal(
      Buffer.from(
        ok(f().native.readBounded({ file: retained, maximumBytes: 100 })),
      ).toString(),
      "retained",
    );
    assert.equal(
      ok(f().native.observeAt(f().anchor.directory, name("stage"))).kind,
      "absent",
    );
    ok(
      f().native.requireLocation({
        parent: f().anchor.directory,
        name: name("generation"),
        object,
      }),
    );
    const source = file("promotion-source", Buffer.from("same"));
    file("promotion-foreign", Buffer.from("same"));
    const before = readFileSync(join(f().root, "anchor/promotion-foreign"));
    failed(
      f().native.promoteExclusive({
        interval: f().interval,
        sourceParent: f().anchor.directory,
        sourceName: name("promotion-source"),
        destinationParent: f().anchor.directory,
        destinationName: name("promotion-foreign"),
        expectedObject: identity(source),
      }),
      "exists",
    );
    assert.deepEqual(
      readFileSync(join(f().root, "anchor/promotion-foreign")),
      before,
    );
    assert.equal(
      ok(f().native.observeAt(f().anchor.directory, name("promotion-source")))
        .kind,
      "present",
    );
  });
  const sourceAliases = [
    {
      label: "separate parent handles",
      stored: "stage",
      supplied: "stage",
      separateParent: true,
    },
    {
      label: "case equivalent names",
      stored: "stage-case",
      supplied: "STAGE-CASE",
      separateParent: false,
    },
    {
      label: "Unicode equivalent names",
      stored: "stage-Résumé",
      supplied: "stage-Re\u0301sume\u0301",
      separateParent: false,
    },
    {
      label: "separate parents and case/Unicode equivalent names",
      stored: "stage-Résumé",
      supplied: "STAGE-RE\u0301SUME\u0301",
      separateParent: true,
    },
  ];
  for (const [index, alias] of sourceAliases.entries()) {
    it(`retains promoted directory and descendant handles with ${alias.label}`, () => {
      const parentName = `promotion-alias-${index}`;
      const parent = directory(parentName);
      const alternateParent = alias.separateParent
        ? ok(
            f().native.openDirectoryNoFollow(
              f().anchor.directory,
              name(parentName),
            ),
          )
        : parent;
      if (alternateParent !== parent) f().handles.push(alternateParent);
      const stage = directory(alias.stored, parent);
      const descendant = directory("descendant", stage);
      const retained = file("retained", Buffer.from("retained"), descendant);
      const stageObject = identity(stage),
        descendantObject = identity(descendant),
        fileObject = identity(retained);
      const alternateStage = ok(
        f().native.openDirectoryNoFollow(alternateParent, name(alias.supplied)),
      );
      f().handles.push(alternateStage);
      ok(
        f().native.promoteExclusive({
          interval: f().interval,
          sourceParent: alternateParent,
          sourceName: name(alias.supplied),
          destinationParent: f().anchor.directory,
          destinationName: name(`promoted-alias-${index}`),
          expectedObject: stageObject,
        }),
      );
      for (const handle of [stage, alternateStage])
        assert.deepEqual(identity(handle), stageObject);
      assert.deepEqual(identity(descendant), descendantObject);
      assert.deepEqual(identity(retained), fileObject);
      assert.equal(
        Buffer.from(
          ok(f().native.readBounded({ file: retained, maximumBytes: 100 })),
        ).toString(),
        "retained",
      );
      ok(
        f().native.syncDirectory({
          interval: f().interval,
          directory: descendant,
        }),
      );
      ok(f().native.syncFile({ interval: f().interval, file: retained }));
      assert.equal(
        ok(f().native.observeAt(parent, name(alias.stored))).kind,
        "absent",
      );
      assert.deepEqual(
        ok(
          f().native.requireLocation({
            parent: f().anchor.directory,
            name: name(`promoted-alias-${index}`),
            object: stageObject,
          }),
        ).object,
        stageObject,
      );
      assert.equal(
        readFileSync(
          join(f().root, `anchor/promoted-alias-${index}/descendant/retained`),
          "utf8",
        ),
        "retained",
      );
    });
    for (const expected of ["absent", "present"]) {
      it(`retains ${expected} head temporary handles with ${alias.label}`, () => {
        const parentName = `head-alias-${index}-${expected}`;
        const parent = directory(parentName);
        const alternateParent = alias.separateParent
          ? ok(
              f().native.openDirectoryNoFollow(
                f().anchor.directory,
                name(parentName),
              ),
            )
          : parent;
        if (alternateParent !== parent) f().handles.push(alternateParent);
        const temporary = file(alias.stored, Buffer.from("next"), parent),
          object = identity(temporary);
        const alternateTemporary = ok(
          f().native.openRegularNoFollow(
            alternateParent,
            name(alias.supplied),
            "read",
          ),
        );
        f().handles.push(alternateTemporary);
        const old =
          expected === "present"
            ? file("head", Buffer.from("previous"), parent)
            : undefined;
        ok(
          f().native.replaceHeadGuarded({
            interval: f().interval,
            parent: alternateParent,
            temporaryName: name(alias.supplied),
            temporaryObject: object,
            headName: name("head"),
            expectedHead:
              old === undefined
                ? { kind: "absent" }
                : {
                    kind: "present",
                    object: identity(old),
                    bytes: Buffer.from("previous"),
                  },
          }),
        );
        for (const handle of [temporary, alternateTemporary]) {
          assert.deepEqual(identity(handle), object);
          assert.equal(
            Buffer.from(
              ok(f().native.readBounded({ file: handle, maximumBytes: 100 })),
            ).toString(),
            "next",
          );
        }
        ok(f().native.syncFile({ interval: f().interval, file: temporary }));
        assert.equal(
          ok(f().native.observeAt(parent, name(alias.stored))).kind,
          "absent",
        );
        assert.deepEqual(
          ok(f().native.requireLocation({ parent, name: name("head"), object }))
            .object,
          object,
        );
        assert.equal(
          readFileSync(join(f().root, `anchor/${parentName}/head`), "utf8"),
          "next",
        );
        if (old !== undefined)
          failed(f().native.observe(old), "identity-changed");
      });
    }
  }
  it("does not rebind stale handles whose former names now hold foreign objects", () => {
    for (const operation of ["promotion", "head"]) {
      const parentName = `stale-${operation}`,
        parent = directory(parentName);
      const stale = file("original", Buffer.from("owned"), parent),
        object = identity(stale);
      renameSync(
        join(f().root, `anchor/${parentName}/original`),
        join(f().root, `anchor/${parentName}/current`),
      );
      const foreign = file("original", Buffer.from("foreign"), parent),
        foreignObject = identity(foreign);
      const current = ok(
        f().native.openRegularNoFollow(parent, name("current"), "read"),
      );
      f().handles.push(current);
      if (operation === "promotion") {
        ok(
          f().native.promoteExclusive({
            interval: f().interval,
            sourceParent: parent,
            sourceName: name("current"),
            destinationParent: parent,
            destinationName: name("final"),
            expectedObject: object,
          }),
        );
      } else {
        ok(
          f().native.replaceHeadGuarded({
            interval: f().interval,
            parent,
            temporaryName: name("current"),
            temporaryObject: object,
            headName: name("final"),
            expectedHead: { kind: "absent" },
          }),
        );
      }
      failed(f().native.observe(stale), "identity-changed");
      assert.deepEqual(identity(current), object);
      assert.deepEqual(identity(foreign), foreignObject);
      assert.equal(
        Buffer.from(
          ok(f().native.readBounded({ file: current, maximumBytes: 100 })),
        ).toString(),
        "owned",
      );
      assert.equal(
        readFileSync(join(f().root, `anchor/${parentName}/original`), "utf8"),
        "foreign",
      );
      assert.equal(
        readFileSync(join(f().root, `anchor/${parentName}/final`), "utf8"),
        "owned",
      );
    }
  });
  it("guards absent and present heads by physical object and exact bytes", () => {
    const old = file("head-temporary-a", Buffer.from("A")),
      oldObject = identity(old);
    ok(
      f().native.replaceHeadGuarded({
        interval: f().interval,
        parent: f().anchor.directory,
        temporaryName: name("head-temporary-a"),
        temporaryObject: oldObject,
        headName: name("head"),
        expectedHead: { kind: "absent" },
      }),
    );
    const next = file("head-temporary-b", Buffer.from("B")),
      nextObject = identity(next);
    const input = {
      interval: f().interval,
      parent: f().anchor.directory,
      temporaryName: name("head-temporary-b"),
      temporaryObject: nextObject,
      headName: name("head"),
    };
    failed(
      f().native.replaceHeadGuarded({
        ...input,
        expectedHead: { kind: "absent" },
      }),
      "exists",
    );
    failed(
      f().native.replaceHeadGuarded({
        ...input,
        expectedHead: {
          kind: "present",
          object: oldObject,
          bytes: Buffer.from("wrong"),
        },
      }),
      "identity-changed",
    );
    failed(
      f().native.replaceHeadGuarded({
        ...input,
        expectedHead: {
          kind: "present",
          object: { ...oldObject, inode: "1" },
          bytes: Buffer.from("A"),
        },
      }),
      "identity-changed",
    );
    assert.equal(readFileSync(join(f().root, "anchor/head"), "utf8"), "A");
    ok(
      f().native.replaceHeadGuarded({
        ...input,
        expectedHead: {
          kind: "present",
          object: oldObject,
          bytes: Buffer.from("A"),
        },
      }),
    );
    assert.equal(readFileSync(join(f().root, "anchor/head"), "utf8"), "B");
    failed(f().native.observe(old), "identity-changed");
    assert.deepEqual(identity(next), nextObject);
  });
  it("refuses moved parent handles before effects and preserves the old object", () => {
    const parent = directory("linked-parent"),
      target = file("owned", Buffer.from("protected"), parent),
      object = identity(target);
    renameSync(
      join(f().root, "anchor/linked-parent"),
      join(f().root, "anchor/retained-moved-parent"),
    );
    mkdirSync(join(f().root, "anchor/linked-parent"), { mode: 0o700 });
    failed(
      f().native.writeExact({
        interval: f().interval,
        file: target,
        bytes: Buffer.from("escaped"),
        expectedObject: object,
      }),
      "identity-changed",
    );
    assert.equal(
      readFileSync(
        join(f().root, "anchor/retained-moved-parent/owned"),
        "utf8",
      ),
      "protected",
    );
    assert.deepEqual(readdirSync(join(f().root, "anchor/linked-parent")), []);
  });
  it("refuses symlinks, hardlinks and FIFOs before ordinary file opens", () => {
    file("hardlink-owned", Buffer.from("protected"));
    linkSync(
      join(f().root, "anchor/hardlink-owned"),
      join(f().root, "anchor/hardlink-alias"),
    );
    failed(
      f().native.openRegularNoFollow(
        f().anchor.directory,
        name("hardlink-alias"),
        "read",
      ),
      "unsafe-ancestry",
    );
    failed(
      f().native.observeAt(f().anchor.directory, name("hardlink-alias")),
      "unsafe-ancestry",
    );
    symlinkSync("hardlink-owned", join(f().root, "anchor/symlink"));
    failed(
      f().native.openRegularNoFollow(
        f().anchor.directory,
        name("symlink"),
        "read",
      ),
      "unsafe-ancestry",
    );
    execFileSync("mkfifo", [join(f().root, "anchor/fifo")]);
    failed(
      f().native.openRegularNoFollow(
        f().anchor.directory,
        name("fifo"),
        "read",
      ),
      "unsafe-ancestry",
    );
    assert.equal(
      readFileSync(join(f().root, "anchor/hardlink-owned"), "utf8"),
      "protected",
    );
  });
  it("refuses sidecar-directory aliases while observing its metadata", () => {
    mkdirSync(join(f().root, "anchor/journal-ownership"), { mode: 0o700 });
    const sidecar = join(f().root, "anchor/journal-ownership/protected.sqlite");
    writeFileSync(sidecar, Buffer.alloc(0), { mode: 0o600 });
    assert.equal(
      ok(f().native.observeAt(f().anchor.directory, name("journal-ownership")))
        .kind,
      "present",
    );
    failed(
      f().native.openDirectoryNoFollow(
        f().anchor.directory,
        name("journal-ownership"),
      ),
      "unsafe-ancestry",
    );
    failed(
      f().native.openDirectoryNoFollow(
        f().anchor.directory,
        name("JOURNAL-OWNERSHIP"),
      ),
      "unsafe-ancestry",
    );
    assert.equal(statSync(sidecar).size, 0);
  });
  it("keeps exact SQLite ownership through excluded sidecar aliases", async () => {
    const stateRoot = join(f().root, "anchor"),
      journalPath = join(stateRoot, "academic-os-control-publication.jsonl");
    const key = createHash("sha256").update(journalPath).digest("hex");
    const sidecar = join(stateRoot, "journal-ownership", `${key}.sqlite`);
    const alias = join(f().root, "sidecar-alias");
    const helper = pathToFileURL(
      resolve("dist/src/journal-mutation-owner.js"),
    ).href;
    const observations: unknown[] = [];
    const owned = await withJournalMutationOwner(
      { stateRoot, journalPath },
      async () => {
        symlinkSync(sidecar, alias);
        for (const path of [sidecar, alias]) {
          const observed = f().native.observeExclusionRoots({
            anchor: f().anchor,
            requiredRepositoryAndSourcePaths: [Buffer.from(path)],
          });
          failed(observed);
          const script = `const {withJournalMutationOwner}=await import(${JSON.stringify(helper)});const r=await withJournalMutationOwner(${JSON.stringify({ stateRoot, journalPath })},async()=>"entered");process.stdout.write(JSON.stringify(r));`;
          const contender = spawnSync(
            process.execPath,
            ["--input-type=module", "-e", script],
            { encoding: "utf8", timeout: 10000 },
          );
          assert.equal(contender.status, 0, contender.stderr);
          const result: unknown = JSON.parse(contender.stdout);
          assert.ok(
            typeof result === "object" &&
              result !== null &&
              "kind" in result &&
              result.kind === "refused" &&
              "reason" in result &&
              result.reason === "busy",
            "excluded sidecar traversal released the exact SQLite owner",
          );
          let alive = false;
          try {
            process.kill(contender.pid, 0);
            alive = true;
          } catch {}
          assert.equal(alive, false);
          observations.push({
            path,
            observed,
            contender: {
              pid: contender.pid,
              status: contender.status,
              stdout: contender.stdout,
              stderr: contender.stderr,
              aliveAfter: alive,
            },
          });
        }
        return "held-through-exclusions";
      },
    );
    assert.deepEqual(owned, {
      kind: "owned",
      value: "held-through-exclusions",
    });
    writeFileSync(
      join(f().root, "sidecar-exclusion-owner.json"),
      JSON.stringify(observations, null, 2),
    );
    exclusions();
  });
  it("rejects foreign ACL grants despite 0700 and accepts safe deny entries", () => {
    const denied = directory("safe-deny"),
      granted = directory("foreign-allow");
    execFileSync("chmod", [
      "+a",
      "everyone deny delete",
      join(f().root, "anchor/safe-deny"),
    ]);
    assert.equal(ok(f().native.observe(denied)).metadata.mode, 0o700);
    execFileSync("chmod", [
      "+a",
      "everyone allow read",
      join(f().root, "anchor/foreign-allow"),
    ]);
    assert.equal(
      lstatSync(join(f().root, "anchor/foreign-allow")).mode & 0o777,
      0o700,
    );
    failed(f().native.observe(granted), "unsafe-ancestry");
  });
  it("physically resolves exclusions, rejects overlap, and rechecks aliases and absences", () => {
    failed(
      f().native.observeExclusionRoots({
        anchor: f().anchor,
        requiredRepositoryAndSourcePaths: [
          Buffer.from(join(f().root, "missing")),
        ],
      }),
      "missing",
    );
    failed(
      f().native.observeExclusionRoots({
        anchor: f().anchor,
        requiredRepositoryAndSourcePaths: [Buffer.from(f().root)],
      }),
      "unsafe-ancestry",
    );
    const protectedRoot = join(f().root, "protected"),
      alias = join(f().root, "protected-alias");
    mkdirSync(protectedRoot, { mode: 0o700 });
    symlinkSync("protected", alias);
    exclusions([alias]);
    file("safe-with-alias", Buffer.from("safe"));
    renameSync(alias, `${alias}-original`);
    symlinkSync("anchor", alias);
    failed(
      f().native.createRegularExclusive({
        interval: f().interval,
        parent: f().anchor.directory,
        name: name("blocked-alias"),
      }),
      "identity-changed",
    );
    assert.equal(existsSync(join(f().root, "anchor/blocked-alias")), false);
    renameSync(alias, `${alias}-changed`);
    renameSync(`${alias}-original`, alias);
    exclusions();
    mkdirSync(join(f().root, "account/Dropbox"), { mode: 0o700 });
    failed(
      f().native.createRegularExclusive({
        interval: f().interval,
        parent: f().anchor.directory,
        name: name("blocked-absence"),
      }),
      "identity-changed",
    );
    renameSync(
      join(f().root, "account/Dropbox"),
      join(f().root, "account/appeared-Dropbox"),
    );
    exclusions();
  });
  it("supports identity-bound directory bookmarks and refuses stale or regular bookmarks", () => {
    const root = join(f().root, "bookmark-target"),
      alias = join(f().root, "directory.alias");
    mkdirSync(root, { mode: 0o700 });
    execFileSync(join(f().root, "alias-fixture"), [root, alias]);
    exclusions([alias]);
    file("safe-with-bookmark", Buffer.from("safe"));
    renameSync(root, `${root}-retained`);
    mkdirSync(root, { mode: 0o700 });
    failed(
      f().native.createRegularExclusive({
        interval: f().interval,
        parent: f().anchor.directory,
        name: name("blocked-bookmark"),
      }),
      "unsupported-host",
    );
    assert.equal(existsSync(join(f().root, "anchor/blocked-bookmark")), false);
    renameSync(root, `${root}-replacement`);
    renameSync(`${root}-retained`, root);
    const regularPath = join(f().root, "bookmark-regular"),
      regularAlias = join(f().root, "regular.alias");
    writeFileSync(regularPath, "regular", { mode: 0o600 });
    execFileSync(join(f().root, "alias-fixture"), [regularPath, regularAlias]);
    failed(
      f().native.observeExclusionRoots({
        anchor: f().anchor,
        requiredRepositoryAndSourcePaths: [Buffer.from(regularAlias)],
      }),
      "unsupported-host",
    );
    exclusions();
  });
  it("retains no traversal descriptors in exclusion observations", () => {
    const before = readdirSync("/dev/fd").length;
    for (let i = 0; i < 20; i += 1) exclusions();
    assert.equal(readdirSync("/dev/fd").length, before);
  });
  it("exposes distinct fixture syscall boundaries and fails a barrier without success", () => {
    const target = file("barrier", Buffer.from("barrier")),
      edges: string[] = [];
    f().native.setFixtureCheckpoint((edge) => edges.push(edge));
    ok(f().native.syncFile({ interval: f().interval, file: target }));
    ok(
      f().native.syncDirectory({
        interval: f().interval,
        directory: f().anchor.directory,
      }),
    );
    f().native.setFixtureCheckpoint((edge) => {
      if (edge === "before-file-sync")
        throw new Error("fixture barrier failure");
    });
    failed(f().native.syncFile({ interval: f().interval, file: target }), "io");
    f().native.setFixtureCheckpoint(undefined);
    assert.ok(
      edges.includes("before-handle-guard") &&
        edges.includes("before-file-sync") &&
        edges.includes("after-file-sync") &&
        edges.includes("before-directory-sync") &&
        edges.includes("after-directory-sync"),
    );
    writeFileSync(
      join(f().root, "native-edges.json"),
      JSON.stringify(edges, null, 2),
    );
    assert.equal(
      readFileSync(join(f().root, "anchor/barrier"), "utf8"),
      "barrier",
    );
  });
  it("closes interval admission synchronously and handles explicit close idempotently", () => {
    const target = file("expired", Buffer.from("retained")),
      object = identity(target);
    const interval = ok(f().native.beginIntervalUnderHeldGate(f().anchor));
    ok(f().native.expireAndDrain(interval));
    failed(
      f().native.writeExact({
        interval,
        file: target,
        bytes: Buffer.from("late"),
        expectedObject: object,
      }),
      "expired",
    );
    failed(f().native.syncFile({ interval, file: target }), "expired");
    failed(
      f().native.createRegularExclusive({
        interval,
        parent: f().anchor.directory,
        name: name("late-create"),
      }),
      "expired",
    );
    assert.equal(
      readFileSync(join(f().root, "anchor/expired"), "utf8"),
      "retained",
    );
    const failingInterval = ok(
      f().native.beginIntervalUnderHeldGate(f().anchor),
    );
    f().native.setFixtureCheckpoint((edge) => {
      if (edge === "before-expiry") throw new Error("fixture expiry failure");
    });
    failed(f().native.expireAndDrain(failingInterval), "io");
    f().native.setFixtureCheckpoint(undefined);
    failed(
      f().native.syncFile({ interval: failingInterval, file: target }),
      "expired",
    );
    ok(f().native.close(target));
    ok(f().native.close(target));
    failed(f().native.observe(target), "expired");
  });
  it("appends beyond 64 MiB and reads a stable bounded snapshot without a lifetime cap", () => {
    const target = file("large-ledger", Buffer.alloc(64 * 1024 * 1024, 120));
    const object = identity(target);
    ok(
      f().native.appendExact({
        interval: f().interval,
        file: target,
        bytes: Buffer.from("!"),
        expectedObject: object,
        expectedLength: 64 * 1024 * 1024,
      }),
    );
    assert.equal(
      statSync(join(f().root, "anchor/large-ledger")).size,
      64 * 1024 * 1024 + 1,
    );
    let result = ok(f().native.readLedger({ kind: "first", file: target }));
    let offset = 0;
    let windows = 0;
    while (true) {
      assert.equal(result.totalLength, 64 * 1024 * 1024 + 1);
      assert.ok(result.bytes.byteLength <= 65536);
      assert.equal(
        result.bytes[0],
        offset === result.totalLength - 1 ? 33 : 120,
      );
      offset += result.bytes.byteLength;
      windows++;
      if (offset === result.totalLength) break;
      result = ok(
        f().native.readLedger({
          kind: "next",
          file: target,
          snapshot: result.snapshot,
          offset,
        }),
      );
    }
    assert.equal(windows, 1025);
    failed(
      f().native.readLedger({
        kind: "next",
        file: target,
        snapshot: result.snapshot,
        offset,
      }),
      "unsafe-ancestry",
    );
    const expectedLength = Number.MAX_SAFE_INTEGER;
    failed(
      f().native.appendExact({
        interval: f().interval,
        file: target,
        bytes: Buffer.from("!"),
        expectedObject: object,
        expectedLength,
      }),
      "unsafe-ancestry",
    );
    failed(
      f().native.appendExact({
        interval: f().interval,
        file: target,
        bytes: Buffer.from("!"),
        expectedObject: object,
        expectedLength: expectedLength - 1,
      }),
      "identity-changed",
    );
    for (const length of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
      failed(
        f().native.appendExact({
          interval: f().interval,
          file: target,
          bytes: Buffer.from("!"),
          expectedObject: object,
          expectedLength: length,
        }),
        "unsafe-ancestry",
      );
    assert.equal(
      statSync(join(f().root, "anchor/large-ledger")).size,
      64 * 1024 * 1024 + 1,
    );
    writeFileSync(
      join(f().root, "large-read.json"),
      JSON.stringify({ windows, bytes: offset, perCallMaximum: 65536 }),
    );
  });
  it("rejects forged, cross-file, out-of-order and expired snapshots", () => {
    const target = file("snapshot-token", Buffer.alloc(65537)),
      other = file("snapshot-other", Buffer.alloc(65537));
    const first = ok(f().native.readLedger({ kind: "first", file: target }));
    for (const snapshot of [{}, f().anchor, target])
      failed(
        Reflect.apply(f().native.readLedger, f().native, [
          { kind: "next", file: target, snapshot, offset: 65536 },
        ]),
        "unsafe-ancestry",
      );
    failed(
      f().native.readLedger({
        kind: "next",
        file: other,
        snapshot: first.snapshot,
        offset: 65536,
      }),
      "unsafe-ancestry",
    );
    for (const offset of [0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])
      failed(
        f().native.readLedger({
          kind: "next",
          file: target,
          snapshot: first.snapshot,
          offset,
        }),
        "unsafe-ancestry",
      );
    ok(f().native.close(target));
    failed(
      f().native.readLedger({
        kind: "next",
        file: target,
        snapshot: first.snapshot,
        offset: 65536,
      }),
      "expired",
    );
  });
  it("rejects size, mtime, ctime and linkage changes between windows and during the final read", () => {
    const mutations = [
      "grow",
      "truncate",
      "mtime",
      "ctime",
      "replacement",
      "parent",
      "native-promotion",
    ];
    for (const mutation of mutations) {
      const parentName = `snapshot-${mutation}`,
        parent = directory(parentName);
      const target = file("ledger", Buffer.alloc(65537, 120), parent),
        path = join(f().root, "anchor", parentName, "ledger");
      const first = ok(f().native.readLedger({ kind: "first", file: target }));
      const stat = statSync(path);
      if (mutation === "grow") truncateSync(path, 65538);
      if (mutation === "truncate") truncateSync(path, 65536);
      if (mutation === "mtime")
        utimesSync(path, stat.atime, new Date(stat.mtimeMs - 1000));
      if (mutation === "ctime") {
        const before = statSync(path, { bigint: true });
        chmodSync(path, 0o600);
        const after = statSync(path, { bigint: true });
        assert.equal(after.mtimeNs, before.mtimeNs);
        assert.notEqual(after.ctimeNs, before.ctimeNs);
      }
      if (mutation === "replacement") {
        renameSync(path, `${path}-retained`);
        writeFileSync(path, Buffer.alloc(65537, 120), { mode: 0o600 });
      }
      if (mutation === "parent") {
        renameSync(
          join(f().root, "anchor", parentName),
          join(f().root, "anchor", `${parentName}-retained`),
        );
        mkdirSync(join(f().root, "anchor", parentName), { mode: 0o700 });
      }
      if (mutation === "native-promotion")
        ok(
          f().native.promoteExclusive({
            interval: f().interval,
            sourceParent: parent,
            sourceName: name("ledger"),
            destinationParent: parent,
            destinationName: name("promoted"),
            expectedObject: identity(target),
          }),
        );
      failed(
        f().native.readLedger({
          kind: "next",
          file: target,
          snapshot: first.snapshot,
          offset: 65536,
        }),
        "identity-changed",
      );
    }
    for (const edge of ["before-read", "after-read"]) {
      const target = file(`final-${edge}`, Buffer.alloc(65537, 120));
      const first = ok(f().native.readLedger({ kind: "first", file: target }));
      f().native.setFixtureCheckpoint((hit) => {
        if (hit === edge)
          truncateSync(
            join(f().root, `anchor/final-${edge}`),
            edge === "before-read" ? 65536 : 65538,
          );
      });
      failed(
        f().native.readLedger({
          kind: "next",
          file: target,
          snapshot: first.snapshot,
          offset: 65536,
        }),
        edge === "before-read" ? "io" : "identity-changed",
      );
      f().native.setFixtureCheckpoint(undefined);
    }
  });
  it("replays strict records across LF and UTF-8 windows and exposes no incomplete snapshot", () => {
    const exclusions = ok(
      f().native.observeExclusionRoots({
        anchor: f().anchor,
        requiredRepositoryAndSourcePaths: [Buffer.from(process.cwd())],
      }),
    );
    const record: PublicationRecord = {
      schemaVersion: 1,
      kind: "file-claimed",
      requestId: "replay",
      attemptId: "replay",
      path: "replay",
      file: {
        ...ok(f().native.observe(f().anchor.directory)),
        object: {
          ...identity(f().anchor.directory),
          volumeUuid: "😀".repeat(32768),
        },
        location: {
          parent: f().anchor.host.anchor,
          rawNameBase64: Buffer.from("replay").toString("base64"),
        },
      },
      planned: { byteLength: 0, byteSha256: "f".repeat(64) },
    };
    const event: JournalEvent = {
      schemaVersion: 1,
      sequence: 0,
      previousEventByteSha256: null,
      record,
    };
    const boundaryRecord = structuredClone(record);
    boundaryRecord.file.object.volumeUuid = "f";
    const boundaryEvent = { ...event, record: boundaryRecord };
    const base = encodePublication(boundaryEvent).byteLength;
    boundaryRecord.file.object.volumeUuid += "x".repeat(65535 - base);
    const line = encodePublication(boundaryEvent);
    assert.equal(line.byteLength, 65535);
    let second = encodePublication({
      ...event,
      sequence: 1,
      previousEventByteSha256: sha256(line),
    });
    while (((second[65536] ?? 0) & 0xc0) !== 0x80) {
      record.file.object.volumeUuid = `x${record.file.object.volumeUuid}`;
      second = encodePublication({
        ...event,
        sequence: 1,
        previousEventByteSha256: sha256(line),
      });
    }
    const bytes = Buffer.concat([
      line,
      Buffer.from("\n"),
      second,
      Buffer.from("\n"),
    ]);
    const load = (suffix: string, input: Uint8Array) => {
      const store = new PublicationStore(
        f().native,
        f().anchor,
        exclusions,
        f().interval,
      );
      store.ledger = file(`replay-${suffix}`, Buffer.from(input));
      return store;
    };
    const accepted = load("valid", bytes);
    accepted.load();
    assert.deepEqual(accepted.records(), [boundaryRecord, record]);
    for (const [label, input] of [
      ["torn", bytes.subarray(0, bytes.length - 1)],
      ["duplicate", Buffer.from('{"schemaVersion":1,"schemaVersion":1}\n')],
      ["utf8", Buffer.from([255, 10])],
      [
        "hash",
        Buffer.concat([
          line,
          Buffer.from("\n"),
          encodePublication({
            ...event,
            sequence: 1,
            previousEventByteSha256: "0".repeat(64),
          }),
          Buffer.from("\n"),
        ]),
      ],
      [
        "sequence",
        Buffer.concat([line, Buffer.from("\n"), line, Buffer.from("\n")]),
      ],
      [
        "version",
        Buffer.concat([
          encodePublication({ ...event, schemaVersion: 2 }),
          Buffer.from("\n"),
        ]),
      ],
      ["canonical", Buffer.concat([Buffer.from(" "), line, Buffer.from("\n")])],
      ["overlong", Buffer.alloc(8 * 1024 * 1024, 120)],
    ] satisfies [string, Uint8Array][]) {
      const store = load(label, input);
      assert.throws(
        () => store.load(),
        (error) =>
          error instanceof PublicationFailure &&
          error.result.kind === "recovery-required" &&
          error.result.code === "journal-recovery-required",
      );
      assert.deepEqual(store.records(), []);
    }
    const changed = load("changed", bytes);
    let reads = 0;
    f().native.setFixtureCheckpoint((edge) => {
      if (edge === "after-read" && ++reads === 2)
        truncateSync(join(f().root, "anchor/replay-changed"), bytes.length + 1);
    });
    assert.throws(() => changed.load(), PublicationFailure);
    f().native.setFixtureCheckpoint(undefined);
    assert.deepEqual(changed.records(), []);
  });
  it("appends the terminal sequence once and refuses any successor without changing evidence", () => {
    const exclusions = ok(
      f().native.observeExclusionRoots({
        anchor: f().anchor,
        requiredRepositoryAndSourcePaths: [Buffer.from(process.cwd())],
      }),
    );
    const store = new PublicationStore(
      f().native,
      f().anchor,
      exclusions,
      f().interval,
    );
    store.ledger = file("academic-os-control-publication.jsonl");
    store.ledgerClaim = store.claim(
      f().anchor.directory,
      "academic-os-control-publication.jsonl",
      store.ledger,
    );
    Reflect.set(store, "nextSequence", Number.MAX_SAFE_INTEGER);
    const record: PublicationRecord = {
      schemaVersion: 1,
      kind: "directory-claimed",
      requestId: "terminal",
      attemptId: "terminal",
      directory: store.ledgerClaim,
    };
    store.append(record);
    const before = readFileSync(
      join(f().root, "anchor/academic-os-control-publication.jsonl"),
    );
    assert.equal(
      JSON.parse(before.toString()).sequence,
      Number.MAX_SAFE_INTEGER,
    );
    assert.throws(
      () => store.append(record),
      (error) =>
        error instanceof PublicationFailure &&
        error.result.kind === "recovery-required" &&
        error.result.code === "durability-unavailable",
    );
    assert.deepEqual(
      readFileSync(
        join(f().root, "anchor/academic-os-control-publication.jsonl"),
      ),
      before,
    );
  });
  it("cleans only the exact addon artifact and refuses a foreign binary", () => {
    const root = join(f().root, "cleaner"),
      scripts = join(root, "scripts"),
      output = join(root, "dist/src/controls-publication/native");
    mkdirSync(scripts, { recursive: true, mode: 0o700 });
    mkdirSync(output, { recursive: true, mode: 0o700 });
    copyFileSync(
      "scripts/clean-build-output.mjs",
      join(scripts, "clean-build-output.mjs"),
    );
    writeFileSync(
      join(root, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { outDir: "dist" } }),
    );
    writeFileSync(join(output, "publication-native.node"), "owned-addon");
    writeFileSync(join(dirname(output), "release.json"), "owned-release");
    writeFileSync(join(output, "index.js"), "owned-js");
    execFileSync(process.execPath, [join(scripts, "clean-build-output.mjs")]);
    assert.equal(existsSync(join(root, "dist")), false);
    mkdirSync(output, { recursive: true, mode: 0o700 });
    writeFileSync(join(output, "foreign.node"), "foreign");
    const result = spawnSync(
      process.execPath,
      [join(scripts, "clean-build-output.mjs")],
      { encoding: "utf8" },
    );
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /Refusing to clean build output\. Unsupported entry/,
    );
    assert.equal(readFileSync(join(output, "foreign.node"), "utf8"), "foreign");
  });
});
