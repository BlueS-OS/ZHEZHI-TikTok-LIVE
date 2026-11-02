export function socialAnnouncement(event) {
  const name = event.user?.name || "alguien";
  if (event.kind === "like") return `A ${name} le gusta el directo`;
  if (event.kind === "join") return `Bienvenido, ${name}`;
  return "";
}
