// El sonido del vídeo es independiente del audio personalizado y de la voz.
export function showAlertVideo(container, url, chroma = "none", sound = true) {
  const video = document.createElement("video");
  video.src = url;
  video.muted = !sound;
  video.playsInline = true;
  video.preload = "auto";
  video.setAttribute("aria-hidden", "true");
  const canvas = document.createElement("canvas");
  const useChroma = chroma === "green" || chroma === "blue";
  const displayed = useChroma ? canvas : video;
  displayed.className = "custom-alert-video";
  if (useChroma) {
    video.style.display = "none";
    container.append(video, canvas);
  } else {
    container.append(video);
  }
  let stopped = false;
  let frame = 0;
  let lastFrame = 0;
  const timeout = setTimeout(stop, 8000);

  function draw(now) {
    if (stopped) return;
    frame = requestAnimationFrame(draw);
    if (video.readyState < 2 || now - lastFrame < 40) return;
    lastFrame = now;
    const width = Math.min(480, video.videoWidth || 480);
    const height = Math.max(1, Math.round(width * (video.videoHeight || 270) / (video.videoWidth || 480)));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(video, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const r = pixels.data[i], g = pixels.data[i + 1], b = pixels.data[i + 2];
      const target = chroma === "green" ? g : b;
      const rival = chroma === "green" ? b : g;
      const dominance = target - Math.max(r, rival);
      // Atenúa bordes antes de hacer transparente el fondo uniforme.
      const alpha = Math.max(0, Math.min(1, (75 - dominance) / 45));
      if (target > 75) pixels.data[i + 3] = Math.round(pixels.data[i + 3] * alpha);
    }
    context.putImageData(pixels, 0, 0);
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    clearTimeout(timeout);
    cancelAnimationFrame(frame);
    video.pause();
    video.removeAttribute("src");
    video.load();
    video.remove();
    displayed.remove();
  }

  video.addEventListener("ended", stop, { once: true });
  video.addEventListener("error", stop, { once: true });
  if (useChroma) frame = requestAnimationFrame(draw);
  video.play().catch(stop);
  return stop;
}
