package local.zhezhi.minecraft;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import net.fabricmc.api.ClientModInitializer;
import net.minecraft.client.Minecraft;
import net.minecraft.client.server.IntegratedServer;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.Identifier;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntitySpawnReason;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.boss.enderdragon.EndCrystal;
import net.minecraft.world.entity.item.PrimedTnt;
import net.minecraft.tags.FluidTags;
import net.minecraft.world.phys.Vec3;

import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

public class ZhezhiBridge implements ClientModInitializer {
    private static final ExecutorService WORKER = Executors.newSingleThreadExecutor(r -> {
        Thread thread = new Thread(r, "Zhezhi Minecraft 26.3 bridge");
        thread.setDaemon(true);
        return thread;
    });
    private static final ScheduledExecutorService DETONATOR = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread thread = new Thread(r, "Zhezhi crystal timer");
        thread.setDaemon(true);
        return thread;
    });
    private static final int PORT = resolvePort();
    private static long nextPoll;

    private static int resolvePort() {
        String raw = System.getProperty("zhezhi.port");
        if (raw == null) raw = System.getenv("ZHEZHI_PORT");
        if (raw == null || raw.isBlank()) return 5180;
        try {
            int port = Integer.parseInt(raw.trim());
            if (port >= 1024 && port <= 65535) return port;
        } catch (NumberFormatException ignored) {
            // Se usa el puerto predeterminado.
        }
        System.out.println("[Zhezhi 26.3] Puerto no válido en zhezhi.port/ZHEZHI_PORT; se usa 5180.");
        return 5180;
    }

    @Override
    public void onInitializeClient() {
        System.out.println("[Zhezhi 26.3] Puente preparado para mundo individual de prueba.");
    }

    public static void tick(Minecraft client) {
        IntegratedServer server = client.getSingleplayerServer();
        long now = System.currentTimeMillis();
        if (server == null || client.player == null || now < nextPoll) return;
        nextPoll = now + 2000;
        WORKER.execute(() -> poll(server));
    }

    private static void poll(IntegratedServer server) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL("http://127.0.0.1:" + PORT + "/api/minecraft/poll").openConnection();
            connection.setConnectTimeout(800);
            connection.setReadTimeout(800);
            connection.setRequestProperty("X-Directo", "1");
            if (connection.getResponseCode() != 200) return;
            JsonObject response = JsonParser.parseReader(new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8)).getAsJsonObject();
            JsonArray actions = response.getAsJsonArray("actions");
            if (actions == null) return;
            int remainingMobs = 20;
            int remainingBosses = 5;
            int remainingSpecials = 20;
            for (JsonElement element : actions) {
                if (element.isJsonPrimitive()) {
                    String action = element.getAsString();
                    server.execute(() -> apply(server, action));
                } else if (element.isJsonObject()) {
                    JsonObject action = element.getAsJsonObject();
                    if (!action.has("type") || !"mob".equals(action.get("type").getAsString()) || !action.has("mob")) continue;
                    String mob = action.get("mob").getAsString();
                    boolean special = "primed_tnt".equals(mob) || "end_crystal".equals(mob) || "end_crystal_auto".equals(mob);
                    boolean boss = "wither".equals(mob) || "ender_dragon".equals(mob) || "warden".equals(mob) || "elder_guardian".equals(mob);
                    if (boss && remainingBosses <= 0) continue;
                    String name = action.has("name") ? action.get("name").getAsString() : "";
                    if (special ? remainingSpecials <= 0 : remainingMobs <= 0) continue;
                    int requested = action.has("count") ? action.get("count").getAsInt() : 1;
                    int count = Math.min(special ? remainingSpecials : remainingMobs, Math.max(1, Math.min(boss ? remainingBosses : 20, requested)));
                    if (special) remainingSpecials -= count;
                    else remainingMobs -= count;
                    if (boss) remainingBosses -= count;
                    server.execute(() -> {
                        for (int i = 0; i < count; i++) {
                            if (special) spawnSpecial(server, mob, name, i);
                            else spawnMob(server, mob, name, i);
                        }
                    });
                }
            }
        } catch (Exception ignored) {
            // Zhezhi puede estar apagado; el juego nunca depende de la conexión.
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static void apply(IntegratedServer server, String action) {
        if (server.getPlayerList().getPlayers().size() != 1) return;
        String command;
        switch (action) {
            case "speed": command = "effect give @p minecraft:speed 10 0 true"; break;
            case "zombie": command = "execute at @p run summon minecraft:zombie ~3 ~ ~3"; break;
            case "day": command = "time set day"; break;
            case "night": command = "time set night"; break;
            default: return;
        }
        server.getCommands().performPrefixedCommand(server.createCommandSourceStack(), command);
    }

    private static void spawnSpecial(IntegratedServer server, String action, String name, int slot) {
        if (server.getPlayerList().getPlayers().size() != 1) return;
        if (!"primed_tnt".equals(action) && !"end_crystal".equals(action) && !"end_crystal_auto".equals(action)) return;
        ServerPlayer player = server.getPlayerList().getPlayers().getFirst();
        ServerLevel world = player.level();
        boolean tnt = "primed_tnt".equals(action);
        EntityType<?> type = BuiltInRegistries.ENTITY_TYPE.getValue(Identifier.withDefaultNamespace(tnt ? "tnt" : "end_crystal"));
        if (type == null) return;
        Entity entity = type.create(world, EntitySpawnReason.COMMAND);
        if (entity == null) return;
        Vec3 look = player.getLookAngle();
        double horizontal = Math.hypot(look.x, look.z);
        double forwardX = horizontal > 0.01 ? look.x / horizontal : 0;
        double forwardZ = horizontal > 0.01 ? look.z / horizontal : 1;
        double[][] offsets = { {4, 0}, {5, 2}, {5, -2}, {7, 0}, {7, 3}, {7, -3}, {9, 0}, {9, 4}, {9, -4}, {11, 0} };
        int[] heights = {0, 1, -1, 2, -2};
        boolean found = false;
        for (int index = 0; index < offsets.length; index++) {
            double[] offset = offsets[(index + slot) % offsets.length];
            for (int height : heights) {
                double x = player.getX() + forwardX * offset[0] - forwardZ * offset[1];
                double z = player.getZ() + forwardZ * offset[0] + forwardX * offset[1];
                BlockPos feet = BlockPos.containing(x, player.getY() + height, z);
                if (!world.getBlockState(feet.below()).isSolid()) continue;
                if (!world.getFluidState(feet).isEmpty() || !world.getFluidState(feet.above()).isEmpty()) continue;
                entity.snapTo(feet.getX() + 0.5, feet.getY(), feet.getZ() + 0.5, 0, 0);
                if (!world.noCollision(entity) || !player.hasLineOfSight(entity)) continue;
                found = true;
                break;
            }
            if (found) break;
        }
        if (!found) {
            System.out.println("[Zhezhi 26.3] No hay espacio visible y seguro para " + action);
            return;
        }
        if (tnt) ((PrimedTnt) entity).setFuse(80);
        else ((EndCrystal) entity).setShowBottom(true);
        String label = name.replaceAll("[\\p{Cntrl}]", " ").trim();
        if (!label.isEmpty()) {
            entity.setCustomName(Component.literal(label.substring(0, Math.min(48, label.length()))));
            entity.setCustomNameVisible(true);
        }
        if (world.addFreshEntity(entity)) {
            System.out.println("[Zhezhi 26.3] Explosivo " + action + " generado en " + entity.blockPosition().toShortString());
            if ("end_crystal_auto".equals(action)) DETONATOR.schedule(() -> server.execute(() -> {
                if (!entity.isRemoved() && server.getPlayerList().getPlayers().size() == 1
                    && server.getPlayerList().getPlayers().getFirst().level() == world) {
                    ((EndCrystal) entity).hurtServer(world, world.damageSources().generic(), 1.0F);
                }
            }), 2, TimeUnit.SECONDS);
        }
    }

    private static void spawnMob(IntegratedServer server, String mob, String name, int slot) {
        if (server.getPlayerList().getPlayers().size() != 1) return;
        switch (mob) {
            case "zombie": case "skeleton": case "creeper": case "spider": case "cave_spider":
            case "slime": case "magma_cube": case "witch": case "enderman": case "blaze":
            case "drowned": case "husk": case "stray": case "phantom": case "silverfish":
            case "piglin": case "zombified_piglin": case "hoglin": case "zoglin":
            case "pillager": case "vindicator": case "evoker": case "shulker":
            case "cow": case "pig": case "chicken": case "sheep": case "horse":
            case "rabbit": case "fox": case "wolf": case "panda": case "parrot":
            case "turtle": case "llama": case "ocelot": case "polar_bear":
            case "snow_golem": case "villager": case "wandering_trader":
            case "mooshroom": case "bee": case "iron_golem":
            case "wither": case "ender_dragon": case "warden": case "elder_guardian":
                break;
            default: return;
        }
        ServerPlayer player = server.getPlayerList().getPlayers().getFirst();
        ServerLevel world = player.level();
        boolean boss = "wither".equals(mob) || "ender_dragon".equals(mob) || "warden".equals(mob) || "elder_guardian".equals(mob);
        boolean dragon = "ender_dragon".equals(mob);
        boolean aquatic = "elder_guardian".equals(mob);
        EntityType<?> type = BuiltInRegistries.ENTITY_TYPE.getValue(Identifier.withDefaultNamespace(mob));
        if (type == null) return;
        Entity entity = type.create(world, EntitySpawnReason.COMMAND);
        if (entity == null) return;
        Vec3 look = player.getLookAngle();
        double horizontal = Math.hypot(look.x, look.z);
        double forwardX = horizontal > 0.01 ? look.x / horizontal : 0;
        double forwardZ = horizontal > 0.01 ? look.z / horizontal : 1;
        double[][] offsets = dragon
            ? new double[][] { {18, 0}, {22, 0}, {18, 8}, {18, -8}, {26, 0}, {26, 10}, {26, -10}, {30, 0} }
            : boss
            ? new double[][] { {8, 0}, {10, 0}, {8, 4}, {8, -4}, {12, 0}, {14, 0} }
            : new double[][] { {3, 0}, {4, 0}, {3, 1.5}, {3, -1.5}, {2, 0}, {4, 2}, {4, -2}, {5, 0} };
        int[] heights = {0, 1, -1, 2, -2};
        int[] altitudes = dragon ? new int[] {8, 12, 16} : new int[] {0};
        boolean found = false;
        for (int index = 0; index < offsets.length; index++) {
            double[] offset = offsets[(index + slot) % offsets.length];
            for (int height : heights) {
                double x = player.getX() + forwardX * offset[0] - forwardZ * offset[1];
                double z = player.getZ() + forwardZ * offset[0] + forwardX * offset[1];
                BlockPos feet = BlockPos.containing(x, player.getY() + height, z);
                if (aquatic) {
                    if (!world.getFluidState(feet).is(FluidTags.WATER)
                        || !world.getFluidState(feet.above()).is(FluidTags.WATER)
                        || !world.getFluidState(feet.above(2)).is(FluidTags.WATER)) continue;
                } else {
                    if (!world.getBlockState(feet.below()).isSolid()) continue;
                    if (!world.getFluidState(feet).isEmpty() || !world.getFluidState(feet.above()).isEmpty()) continue;
                }
                for (int altitude : altitudes) {
                    // El dragón necesita espacio sobre el suelo; no se omiten colisión ni visibilidad.
                    entity.snapTo(feet.getX() + 0.5, feet.getY() + altitude, feet.getZ() + 0.5, 0, 0);
                    if (!world.noCollision(entity) || !player.hasLineOfSight(entity)) continue;
                    found = true;
                    break;
                }
                if (found) break;
            }
            if (found) break;
        }
        if (!found) {
            System.out.println("[Zhezhi 26.3] No hay espacio visible y seguro para " + mob);
            return;
        }
        String label = name.replaceAll("[\\p{Cntrl}]", " ").trim();
        if (!label.isEmpty()) {
            entity.setCustomName(Component.literal(label.substring(0, Math.min(48, label.length()))));
            entity.setCustomNameVisible(true);
        }
        if (world.addFreshEntity(entity)) {
            System.out.println("[Zhezhi 26.3] Mob " + mob + " generado en " + entity.blockPosition().toShortString()
                + (label.isEmpty() ? "" : " con nombre"));
        }
    }
}
