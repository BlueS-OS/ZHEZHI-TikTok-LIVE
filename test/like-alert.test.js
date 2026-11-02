import test from "node:test";
import assert from "node:assert/strict";
import { shouldAnnounceLike } from "../src/like-alert.js";

test("limita las alertas de me gusta sin perder los eventos posteriores", () => {
  assert.equal(shouldAnnounceLike(0, 100_000), true);
  assert.equal(shouldAnnounceLike(100_000, 107_999), false);
  assert.equal(shouldAnnounceLike(100_000, 108_000), true);
});
