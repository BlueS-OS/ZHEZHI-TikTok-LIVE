const NETWORK_CODES = /\b(EACCES|EPERM|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|ECONNRESET|CERT_HAS_EXPIRED|UNABLE_TO_VERIFY_LEAF_SIGNATURE)\b/i;

// No enviamos al navegador mensajes crudos: pueden incluir URLs, cookies o claves.
export function safeErrorDetails(error) {
  const nested = [error, error?.cause, ...(Array.isArray(error?.errors) ? error.errors : [])].filter(Boolean);
  const codes = nested
    .map((item) => String(item.code || item.message?.match(NETWORK_CODES)?.[1] || ""))
    .filter((value) => NETWORK_CODES.test(value));
  const message = String(error?.message || "");
  const httpStatus = Number(error?.response?.statusCode || /Unexpected sign server status (\d{3})/.exec(message)?.[1] || 0);
  return {
    type: String(error?.name || "Error").slice(0, 60),
    reason: String(error?.reason || "").slice(0, 60),
    networkCode: codes[0] || "",
    httpStatus: httpStatus >= 100 && httpStatus <= 599 ? httpStatus : null,
  };
}

export async function checkService(url, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(url, { method: "GET", signal: AbortSignal.timeout(8000), redirect: "manual" });
    // Una respuesta HTTP (incluso 403/404) confirma que se pudo llegar al servidor.
    return { reachable: true, httpStatus: response.status, networkCode: "" };
  } catch (error) {
    return { reachable: false, httpStatus: null, networkCode: safeErrorDetails(error).networkCode || "sin respuesta" };
  }
}
