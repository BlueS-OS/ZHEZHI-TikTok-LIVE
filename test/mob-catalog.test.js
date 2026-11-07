import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { MOBS } from "../src/mob-rules.js";
import { MOB_GROUPS, MOB_LABELS, SPECIAL_ACTIONS, SPAWNABLES } from "../public/js/mob-catalog.js";

const MODS = [
  ["1.16.1", "../minecraft-1.16.1/src/main/java/local/zhezhi/minecraft/ZhezhiBridge.java"],
  ["26.3", "../minecraft-26.3/src/main/java/local/zhezhi/minecraft/ZhezhiBridge.java"],
];

test("el catálogo no tiene duplicados y todos los mobs tienen etiqueta", () => {
  assert.equal(new Set(MOBS).size, MOBS.length);
  assert.ok(MOBS.length >= 40, "se esperaba una lista amplia de mobs");
  assert.equal(new Set(MOB_GROUPS.flatMap((group) => group.mobs)).size, MOBS.length);
  for (const mob of MOBS) assert.ok(MOB_LABELS[mob], `falta la etiqueta de ${mob}`);
  assert.equal(new Set(SPAWNABLES).size, SPAWNABLES.length);
  for (const action of SPECIAL_ACTIONS) assert.ok(MOB_LABELS[action], `falta etiqueta de ${action}`);
  for (const previous of ["zombie", "skeleton", "creeper", "spider", "slime", "witch", "enderman", "iron_golem", "cow", "pig", "bee"]) {
    assert.ok(MOBS.includes(previous), `se perdió el mob ${previous}`);
  }
});

for (const [version, file] of MODS) {
  test(`el mod ${version} acepta exactamente los mismos mobs que el catálogo`, async () => {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    const start = source.indexOf("private static void spawnMob");
    assert.notEqual(start, -1, "no se encontró spawnMob en el mod");
    const allowed = [...source.slice(start).matchAll(/case "([a-z_]+)"/g)].map((match) => match[1]);
    const expected = version === "1.16.1" ? MOBS.filter((mob) => mob !== "warden") : MOBS;
    assert.equal(allowed.length, expected.length, "el mod tiene una lista de mobs distinta");
    assert.deepEqual([...allowed].sort(), [...expected].sort());
  });

  test(`el mod ${version} busca agua para el guardián anciano y no limita la dimensión del dragón`, async () => {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.match(source, /"elder_guardian"\.equals\(mob\)/);
    assert.match(source, /FluidTags\.WATER/);
    assert.doesNotMatch(source, /World\.END|Level\.END/);
  });

  test(`el mod ${version} solo acepta los tres explosivos previstos y limita su entrega`, async () => {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    const special = source.slice(source.indexOf("private static void spawnSpecial"), source.indexOf("private static void spawnMob"));
    for (const action of SPECIAL_ACTIONS) assert.ok(special.includes(`"${action}"`), `falta ${action}`);
    assert.match(source, /int remainingSpecials = 20;/);
    assert.match(special, /getBlockState\(feet/);
    assert.match(special, /canSee\(entity\)|hasLineOfSight\(entity\)/);
    assert.match(special, /setFuse\(80\)/);
    assert.match(special, /DETONATOR\.schedule/);
    assert.match(special, /damage\(DamageSource\.GENERIC|hurtServer\(world, world\.damageSources\(\)\.generic/);
  });
}
