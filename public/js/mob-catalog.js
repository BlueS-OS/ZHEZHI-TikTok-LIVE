// Catálogo único de mobs. Lo usan el panel, el servidor y los tests.
// Warden solo existe en 26.3; el mod 1.16.1 lo rechaza explícitamente.
export const MOB_GROUPS = [
  {
    label: "Hostiles",
    mobs: [
      "zombie", "skeleton", "creeper", "spider", "cave_spider", "slime", "magma_cube",
      "witch", "enderman", "blaze", "drowned", "husk", "stray", "phantom", "silverfish",
      "piglin", "zombified_piglin", "hoglin", "zoglin", "pillager", "vindicator", "evoker",
      "shulker",
    ],
  },
  {
    label: "Pasivos y neutrales",
    mobs: [
      "cow", "pig", "chicken", "sheep", "horse", "rabbit", "fox", "wolf", "panda",
      "parrot", "turtle", "llama", "ocelot", "polar_bear", "snow_golem", "villager",
      "wandering_trader", "mooshroom", "bee", "iron_golem",
    ],
  },
  { label: "Jefes · solo mundos de prueba", mobs: ["wither", "ender_dragon", "warden", "elder_guardian"] },
];

export const MOBS = MOB_GROUPS.flatMap((group) => group.mobs);
export const BOSS_MOBS = ["wither", "ender_dragon", "warden", "elder_guardian"];
export const SPECIAL_ACTIONS = ["primed_tnt", "end_crystal", "end_crystal_auto"];
export const SPAWNABLES = [...MOBS, ...SPECIAL_ACTIONS];

export const MOB_LABELS = {
  zombie: "Zombi",
  skeleton: "Esqueleto",
  creeper: "Creeper",
  spider: "Araña",
  cave_spider: "Araña de cueva",
  slime: "Slime",
  magma_cube: "Cubo de magma",
  witch: "Bruja",
  enderman: "Enderman",
  blaze: "Blaze",
  drowned: "Ahogado",
  husk: "Zombi momificado",
  stray: "Esqueleto glacial",
  phantom: "Fantasma",
  silverfish: "Lepisma",
  piglin: "Piglin",
  zombified_piglin: "Piglin zombificado",
  hoglin: "Hoglin",
  zoglin: "Zoglin",
  pillager: "Saqueador",
  vindicator: "Vindicador",
  evoker: "Invocador",
  shulker: "Shulker",
  cow: "Vaca",
  pig: "Cerdo",
  chicken: "Gallina",
  sheep: "Oveja",
  horse: "Caballo",
  rabbit: "Conejo",
  fox: "Zorro",
  wolf: "Lobo",
  panda: "Panda",
  parrot: "Loro",
  turtle: "Tortuga",
  llama: "Llama",
  ocelot: "Ocelote",
  polar_bear: "Oso polar",
  snow_golem: "Muñeco de nieve",
  villager: "Aldeano",
  wandering_trader: "Comerciante ambulante",
  mooshroom: "Mooshroom",
  bee: "Abeja",
  iron_golem: "Gólem de hierro",
  wither: "Wither · jefe",
  ender_dragon: "Dragón del End · jefe",
  warden: "Warden · solo 26.3",
  elder_guardian: "Guardián anciano · jefe acuático",
  primed_tnt: "TNT encendida · explota sola",
  end_crystal: "Cristal del End · explota al golpearlo",
  end_crystal_auto: "Cristal del End · explota solo",
};
