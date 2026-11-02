const HOST = "http://127.0.0.1";

export function voiceStudioBase(port = 3900) {
  const value = Number(port);
  if (!Number.isInteger(value) || value < 1024 || value > 65535) {
    throw new Error("Puerto de VoiceStudio no válido");
  }
  return `${HOST}:${value}`;
}

export function voiceStudioNetworkError(error, port = 3900) {
  const code = String(error?.cause?.code || error?.code || "");
  if (code === "ECONNREFUSED" || code === "ECONNRESET") {
    return new Error(`VoiceStudio no está abierto o no responde en el puerto ${port}. Abre VoiceStudio, espera a que cargue y vuelve a probar.`);
  }
  if (error?.name === "TimeoutError" || code === "ETIMEDOUT") {
    return new Error("VoiceStudio tardó demasiado. Comprueba que terminó de cargar el modelo y vuelve a probar.");
  }
  return new Error(`No pude contactar con VoiceStudio en el puerto ${port}: ${code || error?.message || "sin respuesta"}`);
}

async function request(url, options, port, fetchImpl) {
  try {
    return await fetchImpl(url, options);
  } catch (error) {
    throw voiceStudioNetworkError(error, port);
  }
}

export async function voiceStudioVoices(port = 3900, fetchImpl = fetch) {
  const base = voiceStudioBase(port);
  const health = await request(`${base}/health`, { signal: AbortSignal.timeout(5000) }, port, fetchImpl);
  if (!health.ok) throw new Error("VoiceStudio está iniciándose; espera a que termine de cargar");
  const response = await request(`${base}/v1/audio/voices`, { signal: AbortSignal.timeout(5000) }, port, fetchImpl);
  if (!response.ok) throw new Error(`VoiceStudio no pudo listar las voces (HTTP ${response.status})`);
  const data = await response.json();
  return (Array.isArray(data.voices) ? data.voices : [])
    .filter((voice) => typeof voice.voice_id === "string" && typeof voice.name === "string")
    .map((voice) => ({ id: voice.voice_id.slice(0, 120), name: voice.name.slice(0, 120), type: voice.type || "" }));
}

export async function voiceStudioSpeech(text, options = {}, fetchImpl = fetch) {
  const base = voiceStudioBase(options.port);
  const response = await request(`${base}/v1/audio/speech`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: options.model || "tts-1",
      input: text,
      voice: options.voice || "default",
      response_format: "wav",
      speed: Math.max(0.25, Math.min(4, 1 + (Number(options.rate) || 0) / 100)),
    }),
    signal: AbortSignal.timeout(120_000),
  }, options.port, fetchImpl);
  if (!response.ok) {
    throw new Error(`VoiceStudio no pudo generar la voz (HTTP ${response.status}). Comprueba que su modelo esté instalado y disponible.`);
  }
  const audio = Buffer.from(await response.arrayBuffer());
  if (audio.length < 500 || audio.toString("ascii", 0, 4) !== "RIFF" || audio.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("VoiceStudio no devolvió un archivo WAV válido");
  }
  return audio;
}
