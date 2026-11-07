import test from "node:test";
import assert from "node:assert/strict";
import { createMobRulesState, hasActiveGiftMobRule, matchMobRules, normalizeMobRules, safeMobName } from "../src/mob-rules.js";

const rule = (patch = {}) => ({ id: "a", enabled: true, event: "gift", mob: "zombie", amount: 1, threshold: 1, match: "", chatMatch: "exact", label: "viewer", cooldownSec: 10, ...patch });
const event = (patch = {}) => ({ kind: "gift", diamonds: 2, gift: { name: "Rosa" }, user: { name: "Luna" }, ...patch });

test("normaliza reglas, restringe tipos y no activa entradas nuevas", () => {
  const rules = normalizeMobRules([rule({ id: "x", mob: "/summon", event: "hack", enabled: "true", threshold: -4, cooldownSec: 0, label: "cmd", match: "a".repeat(100) }), rule({ id: "x" }), null]);
  assert.equal(rules.length, 2);
  assert.deepEqual(rules[0], rule({ id: "x", enabled: false, mob: "zombie", threshold: 1, cooldownSec: 3, label: "viewer", match: "a".repeat(80) }));
  assert.notEqual(rules[0].id, rules[1].id);
  assert.equal(normalizeMobRules([rule({ enabled: true, mob: "command_block" })])[0].enabled, false);
  assert.equal(normalizeMobRules([rule({ amount: 999 })])[0].amount, 20);
  assert.equal(normalizeMobRules([rule({ mob: "wither", amount: 999 })])[0].amount, 5);
  assert.equal(normalizeMobRules([rule({ amount: -8 })])[0].amount, 1);
  assert.equal(normalizeMobRules([rule({ amount: "infinito" })])[0].amount, 1);
  assert.equal(normalizeMobRules([rule({ amount: undefined })])[0].amount, 1);
  assert.equal(normalizeMobRules(Array(20).fill(rule())).length, 12);
  assert.deepEqual(normalizeMobRules({}), []);
});

test("regalos filtran por nombre y diamantes con enfriamiento", () => {
  const state = createMobRulesState();
  const rules = [rule({ threshold: 3, match: "Rosa" })];
  assert.deepEqual(matchMobRules(state, event(), rules, 1000), []);
  assert.equal(matchMobRules(state, event({ diamonds: 3, gift: { name: "rosa" } }), rules, 1000)[0].name, "Luna");
  assert.deepEqual(matchMobRules(state, event({ diamonds: 3 }), rules, 2000), []);
  assert.equal(matchMobRules(state, event({ diamonds: 3 }), rules, 11000).length, 1);
});

test("likes suman umbral, pero solo generan tras el enfriamiento", () => {
  const state = createMobRulesState();
  const rules = [rule({ event: "like", threshold: 50 })];
  assert.deepEqual(matchMobRules(state, event({ kind: "like", count: 25 }), rules, 1000), []);
  assert.equal(matchMobRules(state, event({ kind: "like", count: 25 }), rules, 2000).length, 1);
  assert.deepEqual(matchMobRules(state, event({ kind: "like", count: 100 }), rules, 3000), []);
  assert.equal(matchMobRules(state, event({ kind: "like", count: 1 }), rules, 12000).length, 1);
});

test("comentario exacto nombra al mob como texto, sin interpretar comandos", () => {
  const rules = [rule({ event: "chat", match: "/op @a", label: "comment" })];
  assert.deepEqual(matchMobRules(createMobRulesState(), event({ kind: "chat", text: "/op @a\n", hidden: false }), rules, 1000), [{ type: "mob", mob: "zombie", name: "/op @a", count: 1 }]);
  assert.deepEqual(matchMobRules(createMobRulesState(), event({ kind: "chat", text: "/op @a", hidden: true }), rules, 1000), []);
  assert.deepEqual(matchMobRules(createMobRulesState(), event({ kind: "chat", text: "/op @all" }), rules, 1000), []);
  assert.equal(safeMobName("a\u0000\nb"), "a b");
  assert.equal(safeMobName("a\u00a7cb"), "a cb");
  assert.equal(safeMobName("x".repeat(90)).length, 48);
});

test("seguimiento y límite de dos reglas por evento", () => {
  const rules = [rule({ id: "a", event: "follow", label: "none" }), rule({ id: "b", event: "follow" }), rule({ id: "c", event: "follow" })];
  assert.deepEqual(matchMobRules(createMobRulesState(), event({ kind: "follow" }), rules, 1000).map((action) => action.name), ["", "Luna"]);
});

test("una regla de regalo activa sustituye al zombi clásico, incluso durante su enfriamiento", () => {
  assert.equal(hasActiveGiftMobRule([rule({ mob: "cow" })]), true);
  assert.equal(hasActiveGiftMobRule([rule({ event: "follow" })]), false);
  assert.equal(hasActiveGiftMobRule([rule({ enabled: false })]), false);
  assert.equal(hasActiveGiftMobRule([rule({ mob: "command_block" })]), false);
});

test("una rosa genera hasta cinco mobs sin multiplicar la cantidad de regalos", () => {
  const state = createMobRulesState();
  const rules = [rule({ mob: "creeper", match: "Rosa", amount: 5 })];
  assert.deepEqual(matchMobRules(state, event(), rules, 1000), [{ type: "mob", mob: "creeper", name: "Luna", count: 5 }]);
  assert.deepEqual(matchMobRules(state, event(), rules, 1001), []);
  assert.deepEqual(matchMobRules(state, event({ gift: { name: "Helado" } }), rules, 11000), []);
});

test("dos reglas del mismo evento no superan 20 mobs entre ambas", () => {
  const rules = [rule({ id: "a", amount: 16 }), rule({ id: "b", mob: "cow", amount: 20 })];
  assert.deepEqual(matchMobRules(createMobRulesState(), event(), rules, 1000).map((action) => action.count), [16, 4]);
});

test("cualquier comentario es explícito, no acepta vacíos ni mensajes ocultos", () => {
  const any = normalizeMobRules([rule({ event: "chat", match: "", chatMatch: "any", label: "comment" })]);
  const exact = normalizeMobRules([rule({ event: "chat", match: "" })]);
  assert.deepEqual(matchMobRules(createMobRulesState(), event({ kind: "chat", text: "hola" }), exact, 1000), []);
  assert.deepEqual(matchMobRules(createMobRulesState(), event({ kind: "chat", text: "hola" }), any, 1000), [{ type: "mob", mob: "zombie", name: "hola", count: 1 }]);
  assert.deepEqual(matchMobRules(createMobRulesState(), event({ kind: "chat", text: "  " }), any, 1000), []);
  assert.deepEqual(matchMobRules(createMobRulesState(), event({ kind: "chat", text: "hola", hidden: true }), any, 1000), []);
  assert.equal(normalizeMobRules([rule({ chatMatch: "all" })])[0].chatMatch, "exact");
});

test("hasta cinco jefes por evento y enfriamiento editable", () => {
  const state = createMobRulesState();
  const rules = [rule({ id: "boss1", mob: "wither", amount: 5, cooldownSec: 3 }), rule({ id: "boss2", mob: "elder_guardian", amount: 5, cooldownSec: 3 })];
  const normalized = normalizeMobRules(rules);
  assert.deepEqual(normalized.map((item) => [item.amount, item.cooldownSec]), [[5, 3], [5, 3]]);
  assert.deepEqual(matchMobRules(state, event(), rules, 1000).map((item) => [item.mob, item.count]), [["wither", 5]]);
  assert.deepEqual(matchMobRules(state, event(), [rules[1]], 1001).map((item) => [item.mob, item.count]), [["elder_guardian", 5]]);
  assert.deepEqual(matchMobRules(state, event(), [rules[0]], 1002), []);
  assert.deepEqual(matchMobRules(state, event(), [rules[0]], 4000).map((item) => item.mob), ["wither"]);
  const mixed = [rule({ id: "c", mob: "wither", amount: 3 }), rule({ id: "d", mob: "warden", amount: 5 })];
  assert.deepEqual(matchMobRules(createMobRulesState(), event(), mixed, 1000).map((item) => item.count), [3, 2]);
  assert.equal(normalizeMobRules([rule({ mob: "elder_guardian", cooldownSec: undefined })])[0].cooldownSec, 60);
  assert.equal(normalizeMobRules([rule({ mob: "warden" })])[0].mob, "warden");
});

test("los explosivos son explícitos, se limitan a veinte y no activan reglas nuevas", () => {
  for (const mob of ["primed_tnt", "end_crystal", "end_crystal_auto"]) {
    assert.equal(normalizeMobRules([rule({ mob, amount: 999 })])[0].amount, 20);
    assert.equal(normalizeMobRules([rule({ mob, enabled: false })])[0].enabled, false);
    assert.equal(hasActiveGiftMobRule([rule({ mob })]), true);
  }
  assert.equal(normalizeMobRules([rule({ mob: "tnt_command" })])[0].enabled, false);
  const rules = [rule({ id: "a", mob: "primed_tnt", amount: 16 }), rule({ id: "b", mob: "end_crystal_auto", amount: 20 })];
  assert.deepEqual(matchMobRules(createMobRulesState(), event(), rules, 1000).map((action) => [action.mob, action.count]), [["primed_tnt", 16], ["end_crystal_auto", 4]]);
  const mixed = [rule({ id: "normal", mob: "cow", amount: 20 }), rule({ id: "explosive", mob: "end_crystal", amount: 20 })];
  assert.deepEqual(matchMobRules(createMobRulesState(), event(), mixed, 1000).map((action) => action.count), [20, 20]);
});
