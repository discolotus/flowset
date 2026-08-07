export function errorMessage(reason: unknown, fallback: string): string {
  if (reason instanceof Error && reason.message.trim()) return reason.message;
  if (typeof reason === "string" && reason.trim()) return reason.trim();
  return fallback;
}
