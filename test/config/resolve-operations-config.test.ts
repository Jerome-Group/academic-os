import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_OPERATIONS_PORT,
  resolveOperationsConfig,
} from "../../src/config/index.js";

describe("the Operations server's configuration", () => {
  it("defaults to the port the machine-setup checklist registers", () => {
    assert.deepEqual(resolveOperationsConfig({}), {
      port: DEFAULT_OPERATIONS_PORT,
    });
    assert.deepEqual(resolveOperationsConfig({ operations: {} }), {
      port: DEFAULT_OPERATIONS_PORT,
    });
  });

  it("takes a configured port", () => {
    assert.deepEqual(resolveOperationsConfig({ operations: { port: 9100 } }), {
      port: 9100,
    });
  });

  it("refuses a port a user-scoped LaunchAgent could not bind", () => {
    assert.throws(
      () => resolveOperationsConfig({ operations: { port: 80 } }),
      /between 1024 and 65535/u,
    );
    assert.throws(
      () => resolveOperationsConfig({ operations: { port: 8765.5 } }),
      /between 1024 and 65535/u,
    );
    assert.throws(
      () => resolveOperationsConfig({ operations: { port: "8765" } }),
      /between 1024 and 65535/u,
    );
    assert.throws(
      () => resolveOperationsConfig({ operations: 8765 }),
      /must be an object/u,
    );
  });
});
