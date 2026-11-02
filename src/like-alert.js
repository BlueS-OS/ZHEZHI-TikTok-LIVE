export const LIKE_ALERT_INTERVAL_MS = 8000;

export function shouldAnnounceLike(lastAt, now) {
  return now - lastAt >= LIKE_ALERT_INTERVAL_MS;
}
