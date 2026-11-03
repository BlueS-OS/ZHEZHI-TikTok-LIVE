export function socialAnnouncement(event) {
  const name = event.user?.name || "alguien";
  if (event.kind === "like") return `${name} le dio me gusta al directo`;
  if (event.kind === "join") return `Bienvenido, ${name}`;
  return "";
}
