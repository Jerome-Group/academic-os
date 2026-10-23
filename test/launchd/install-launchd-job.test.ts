import assert from "node:assert/strict";
import { chmodSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "node:test";

import {
  installLaunchdJob,
  planLaunchdJob,
  removeLaunchdJob,
} from "../../src/launchd/index.js";
import type { LaunchctlPort, LaunchdJobPlan } from "../../src/launchd/index.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe("LaunchAgent installation", () => {
  it("writes the plist and bootstraps it into the user's GUI domain", async () => {
    const plan = await planInTemporaryHome();
    const launchctl = recordingLaunchctl();

    await installLaunchdJob(plan, launchctl.port);

    assert.deepEqual(launchctl.calls, [
      ["bootstrap", "gui/501", plan.plistPath],
    ]);
    assert.equal(await readFile(plan.plistPath, "utf8"), plan.plist);
    assert.equal((await stat(plan.plistPath)).mode & 0o777, 0o600);
    assert.deepEqual(await leftoverTemporaryFiles(plan), []);
  });

  it("boots the running job out before replacing its plist", async () => {
    const plan = await planInTemporaryHome();
    await seedInstalledPlist(plan, "the previously installed plist");
    const plistWhenUnloaded: string[] = [];
    const launchctl = recordingLaunchctl({
      onBootout: () =>
        plistWhenUnloaded.push(readFileSync(plan.plistPath, "utf8")),
    });

    await installLaunchdJob(plan, launchctl.port);

    assert.deepEqual(launchctl.calls, [
      ["bootout", plan.serviceTarget],
      ["bootstrap", "gui/501", plan.plistPath],
    ]);
    assert.deepEqual(plistWhenUnloaded, ["the previously installed plist"]);
    assert.equal(await readFile(plan.plistPath, "utf8"), plan.plist);
  });

  it("retains the installed plist when launchctl cannot unload the job", async () => {
    const plan = await planInTemporaryHome();
    await seedInstalledPlist(plan, "the previously installed plist");
    const launchctl = recordingLaunchctl({ bootoutStatus: 1 });

    await assert.rejects(
      installLaunchdJob(plan, launchctl.port),
      /plist retained/u,
    );

    assert.deepEqual(launchctl.calls, [["bootout", plan.serviceTarget]]);
    assert.equal(
      await readFile(plan.plistPath, "utf8"),
      "the previously installed plist",
    );
  });

  it("takes the plist back off disk when launchctl refuses to bootstrap it", async () => {
    const plan = await planInTemporaryHome();
    const launchctl = recordingLaunchctl({ bootstrapStatus: 1 });

    await assert.rejects(
      installLaunchdJob(plan, launchctl.port),
      /could not install com\.jerome-group\.academic-os\.nightly-refresh/u,
    );

    assert.equal(await pathExists(plan.plistPath), false);
    assert.deepEqual(await leftoverTemporaryFiles(plan), []);
  });

  it("restores the previous bytes and job after replacement bootstrap fails", async () => {
    const plan = await planInTemporaryHome();
    const previous = Buffer.from([0xef, 0xbb, 0xbf, 0x70, 0xff]);
    await mkdir(dirname(plan.plistPath), { recursive: true });
    await writeFile(plan.plistPath, previous);
    const seen: Buffer[] = [];
    const launchctl = recordingLaunchctl({
      onBootstrap: () => {
        seen.push(readFileSync(plan.plistPath));
        return seen.length === 1 ? 1 : 0;
      },
    });

    await assert.rejects(
      installLaunchdJob(plan, launchctl.port),
      /could not install/u,
    );

    assert.deepEqual(seen, [Buffer.from(plan.plist), previous]);
    assert.deepEqual(await readFile(plan.plistPath), previous);
    assert.deepEqual(await readdir(dirname(plan.plistPath)), [
      plan.plistPath.split("/").at(-1),
    ]);
  });

  it("reports a failed restoration bootstrap while retaining the old plist", async () => {
    const plan = await planInTemporaryHome();
    await seedInstalledPlist(plan, "previous plist bytes");
    const launchctl = recordingLaunchctl({ bootstrapStatus: 1 });

    await assert.rejects(
      installLaunchdJob(plan, launchctl.port),
      /previous plist restored.*bootstrap failed/u,
    );

    assert.equal(
      await readFile(plan.plistPath, "utf8"),
      "previous plist bytes",
    );
    assert.deepEqual(
      launchctl.calls.map(([command]) => command),
      ["bootout", "bootstrap", "bootstrap"],
    );
  });

  for (const failure of ["null", "throw"]) {
    it(`restores the previous job after bootstrap ${failure}`, async () => {
      const plan = await planInTemporaryHome();
      await seedInstalledPlist(plan, "previous plist bytes");
      let attempts = 0;
      const launchctl = recordingLaunchctl({
        onBootstrap: () => {
          attempts += 1;
          if (attempts > 1) return 0;
          if (failure === "null") return null;
          throw new Error("bootstrap exploded");
        },
      });

      await assert.rejects(
        installLaunchdJob(plan, launchctl.port),
        /Previous plist restored and bootstrap succeeded/u,
      );

      assert.equal(attempts, 2);
      assert.equal(
        await readFile(plan.plistPath, "utf8"),
        "previous plist bytes",
      );
    });
  }

  it("refuses an unreadable previous plist before unloading the job", async () => {
    const plan = await planInTemporaryHome();
    await mkdir(plan.plistPath, { recursive: true });
    const launchctl = recordingLaunchctl();

    await assert.rejects(installLaunchdJob(plan, launchctl.port), /EISDIR/u);

    assert.deepEqual(launchctl.calls, []);
  });

  it("restarts the previous job when replacement cannot be written", async () => {
    const plan = await planInTemporaryHome();
    await seedInstalledPlist(plan, "previous plist bytes");
    const directory = dirname(plan.plistPath);
    const seen: string[] = [];
    const launchctl = recordingLaunchctl({
      onBootout: () => chmodSync(directory, 0o500),
      onBootstrap: () => {
        seen.push(readFileSync(plan.plistPath, "utf8"));
        return 0;
      },
    });
    try {
      await assert.rejects(installLaunchdJob(plan, launchctl.port), /EACCES/u);
      assert.deepEqual(seen, ["previous plist bytes"]);
      assert.equal(
        await readFile(plan.plistPath, "utf8"),
        "previous plist bytes",
      );
    } finally {
      await chmod(directory, 0o700);
    }
  });

  it("retains a recoverable snapshot when restoring the canonical path fails", async () => {
    const plan = await planInTemporaryHome();
    await seedInstalledPlist(plan, "previous plist bytes");
    const launchctl = recordingLaunchctl({
      onBootstrap: () => {
        renameSync(plan.plistPath, `${plan.plistPath}.failed`);
        mkdirSync(plan.plistPath);
        return 1;
      },
    });
    await assert.rejects(
      installLaunchdJob(plan, launchctl.port),
      /recoverable plist retained at/u,
    );
    const snapshots = (await readdir(dirname(plan.plistPath))).filter((name) =>
      name.endsWith(".rollback"),
    );
    assert.equal(snapshots.length, 1);
    assert.equal(
      await readFile(
        join(dirname(plan.plistPath), snapshots[0] ?? "missing"),
        "utf8",
      ),
      "previous plist bytes",
    );
    assert.deepEqual(
      launchctl.calls.map(([command]) => command),
      ["bootout", "bootstrap"],
    );
  });

  it("unloads the job and deletes its plist on removal", async () => {
    const plan = await planInTemporaryHome();
    await seedInstalledPlist(plan, plan.plist);
    const launchctl = recordingLaunchctl();

    await removeLaunchdJob(plan, launchctl.port);

    assert.deepEqual(launchctl.calls, [["bootout", plan.serviceTarget]]);
    assert.equal(await pathExists(plan.plistPath), false);
  });

  it("leaves an absent job alone rather than unloading a service it never installed", async () => {
    const plan = await planInTemporaryHome();
    const launchctl = recordingLaunchctl({ bootoutStatus: 1 });

    await removeLaunchdJob(plan, launchctl.port);

    assert.deepEqual(launchctl.calls, []);
  });
});

async function planInTemporaryHome(): Promise<LaunchdJobPlan> {
  const home = await mkdtemp(join(tmpdir(), "academic-os-launchd-home-"));
  temporaryRoots.push(home);
  return planLaunchdJob({
    description: {
      name: "nightly-refresh",
      programArguments: ["/usr/local/bin/node", "/private/academic-os/run.js"],
      schedule: {
        kind: "calendar-interval",
        hour: 5,
        minute: 0,
        timeZone: "Asia/Singapore",
      },
      standardOutPath: "/dev/null",
      standardErrorPath: "/dev/null",
    },
    hostTimeZone: "Asia/Singapore",
    homeDirectory: home,
    uid: 501,
  });
}

async function seedInstalledPlist(
  plan: LaunchdJobPlan,
  content: string,
): Promise<void> {
  await mkdir(dirname(plan.plistPath), { recursive: true });
  await writeFile(plan.plistPath, content);
}

function recordingLaunchctl(
  outcome: {
    bootoutStatus?: number;
    bootstrapStatus?: number;
    onBootout?: () => void;
    onBootstrap?: () => number | null;
  } = {},
): { calls: string[][]; port: LaunchctlPort } {
  const calls: string[][] = [];
  return {
    calls,
    port: {
      bootout(serviceTarget) {
        calls.push(["bootout", serviceTarget]);
        outcome.onBootout?.();
        return outcome.bootoutStatus ?? 0;
      },
      bootstrap(domainTarget, plistPath) {
        calls.push(["bootstrap", domainTarget, plistPath]);
        if (outcome.onBootstrap !== undefined) return outcome.onBootstrap();
        return outcome.bootstrapStatus ?? 0;
      },
    },
  };
}

async function leftoverTemporaryFiles(plan: LaunchdJobPlan): Promise<string[]> {
  const entries = await readdir(dirname(plan.plistPath));
  return entries.filter((entry) => entry.endsWith(".tmp"));
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
