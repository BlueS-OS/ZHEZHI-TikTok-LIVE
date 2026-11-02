import test from "node:test";
import assert from "node:assert/strict";
import { checkService, safeErrorDetails } from "../src/diagnostics.js";

test("el diagnóstico no publica mensajes que podrían contener secretos", () => {
  const error = new Error("Unexpected sign server status 403. Payload: sessionid=secreto");
  error.name = "SignAPIError";
  error.reason = "Sign Error";
  const details = safeErrorDetails(error);
  assert.deepEqual(details, { type: "SignAPIError", reason: "Sign Error", networkCode: "", httpStatus: 403 });
  assert.doesNotMatch(JSON.stringify(details), /secreto/);
});

test("reconoce un error de red anidado", () => {
  const error = new TypeError("fetch failed", { cause: Object.assign(new Error("denied"), { code: "EACCES" }) });
  assert.equal(safeErrorDetails(error).networkCode, "EACCES");
});

test("una respuesta HTTP 404 significa que el servidor es accesible", async () => {
  const result = await checkService("https://example.com", async () => ({ status: 404 }));
  assert.deepEqual(result, { reachable: true, httpStatus: 404, networkCode: "" });
});

test("la comprobación de red devuelve un código seguro", async () => {
  const error = Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" });
  const result = await checkService("https://example.com", async () => { throw error; });
  assert.deepEqual(result, { reachable: false, httpStatus: null, networkCode: "ECONNREFUSED" });
});
