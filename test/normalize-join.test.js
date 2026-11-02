import test from "node:test";
import assert from "node:assert/strict";
import { normalizeJoin } from "../src/normalize.js";

test("la entrada conserva el nombre del usuario para mostrarlo en el overlay", () => {
  const event = normalizeJoin({ user: { id: "123", nickname: "Luna", displayId: "luna_91" } });
  assert.equal(event.kind, "join");
  assert.deepEqual(event.user, { id: "123", name: "Luna", username: "luna_91", avatar: "" });
});
