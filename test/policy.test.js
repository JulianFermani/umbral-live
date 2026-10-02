import test from "node:test";
import assert from "node:assert/strict";
import { makeVerdict } from "../src/policy.js";

test("allows text below the review threshold", () => {
  assert.equal(makeVerdict({ sexual: { noul: 0.1 } }).action, "allow");
});

test("marks uncertain classifications for review", () => {
  const result = makeVerdict({ sexual: { noul: 0.5 } });
  assert.equal(result.action, "review");
  assert.deepEqual(result.matched.map(({ category }) => category), ["sexual"]);
});

test("blocks when any hazard reaches the block threshold", () => {
  assert.equal(makeVerdict({ sexual: { noul: 0.9 } }).action, "block");
});
