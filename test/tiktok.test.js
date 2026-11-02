import test from "node:test";
import assert from "node:assert/strict";
import { buildConnectionOptions, explainConnectionError, TikTokManager } from "../src/tiktok.js";
import { defaultConfig, normalizeConfig } from "../src/config.js";

test("explica el fallo de Room ID sin exponer errores internos", () => {
  const error = new Error("Failed to retrieve Room ID from all sources.");
  error.config = {
    requestErrs: [
      { response: { statusCode: 403 }, message: "Forbidden" },
      { code: "ETIMEDOUT", message: "connect ETIMEDOUT" },
    ],
  };
  const explanation = explainConnectionError(error);
  assert.match(explanation, /Room ID/);
  assert.match(explanation, /acceso restringido/);
  assert.match(explanation, /problema de red/);
  assert.match(explanation, /ventana privada/);
});

test("distingue acceso denegado de un servicio de firma caído", () => {
  const error = new Error("[Connect Error] Failed to connect to sign server. connect EACCES 1.2.3.4:443");
  error.name = "SignAPIError";
  const explanation = explainConnectionError(error);
  assert.match(explanation, /acceso denegado/);
  assert.doesNotMatch(explanation, /Prueba otra vez/);
});

test("identifica límite y rechazo HTTP del servicio de firma", () => {
  assert.match(explainConnectionError({ name: "SignatureRateLimitError", reason: "Rate Limited", message: "Too many connections started" }), /429/);
  assert.match(explainConnectionError({ name: "SignAPIError", message: "Unexpected sign server status 403. Payload: forbidden" }), /rechazó la conexión \(403\)/);
  assert.match(explainConnectionError({ name: "SignAPIError", message: "Unexpected sign server status 500" }), /HTTP 500/);
});

test("explica una respuesta de firma sin tokens", () => {
  const explanation = explainConnectionError({ name: "SignatureMissingTokensError", reason: "Empty Payload", message: "Failed to sign a request due to missing tokens in response!" });
  assert.match(explanation, /sin los tokens necesarios/);
});

test("conserva el Room ID opcional de la configuración", () => {
  assert.equal(normalizeConfig({ tiktok: { roomId: " 1234567890123456789 " } }).tiktok.roomId, "1234567890123456789");
  assert.equal(defaultConfig().tiktok.roomId, "");
});

test("rechaza un Room ID no numérico antes de conectar", async () => {
  const manager = new TikTokManager();
  await assert.rejects(
    manager.connect(normalizeConfig({ tiktok: { username: "ejemplo", roomId: "no-es-un-id" } })),
    /Room ID debe ser un número/,
  );
});

test("puede conectar al chat sin pedir el catálogo de regalos firmado", () => {
  const options = buildConnectionOptions(defaultConfig());
  assert.equal(options.enableExtendedGiftInfo, false);
  assert.equal(options.fetchRoomInfoOnConnect, true);
  assert.equal(options.signApiKey, undefined);
});
