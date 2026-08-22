export function cleanSemanticPrompt(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizeSemanticPrompt(value: string): string {
  return cleanSemanticPrompt(value).toLocaleLowerCase();
}

export function validateSemanticPrompts(
  values: readonly string[],
  maxLabels: number,
): { labels: string[]; error: string | null } {
  const labels = values.map(cleanSemanticPrompt);
  if (labels.some((label) => !label)) {
    return { labels, error: "Name every prompt or remove its empty row." };
  }
  if (labels.some((label) => label.length > 100)) {
    return { labels, error: "Keep every prompt to 100 characters or fewer." };
  }
  if (labels.length > maxLabels) {
    return { labels, error: `This backend accepts at most ${maxLabels} prompts per run.` };
  }
  const normalized = labels.map(normalizeSemanticPrompt);
  if (new Set(normalized).size !== normalized.length) {
    return { labels, error: "Prompt names must be unique after ignoring case and extra spaces." };
  }
  return { labels, error: null };
}
