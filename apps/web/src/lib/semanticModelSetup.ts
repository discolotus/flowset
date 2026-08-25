export function canProvisionSemanticModels(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function provisionSemanticModels({
  acceptRestrictedWeights,
  acceptTrustedCode,
}: {
  acceptRestrictedWeights: boolean;
  acceptTrustedCode: boolean;
}): Promise<string> {
  if (!canProvisionSemanticModels()) {
    throw new Error("Semantic model installation is available in the Flowset desktop app.");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string>("provision_semantic_models", {
    acceptRestrictedWeights,
    acceptTrustedCode,
  });
}
