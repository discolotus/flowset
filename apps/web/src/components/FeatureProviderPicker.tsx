import type {
  AudioFeatureProviderId,
  AudioFeatureProviderOption,
} from "../lib/types";

interface FeatureProviderPickerProps {
  providers: AudioFeatureProviderOption[];
  selectedId: AudioFeatureProviderId;
  onChange: (provider: AudioFeatureProviderId) => void;
  disabled?: boolean;
  coverage?: {
    matched: number;
    unresolved: number;
  } | null;
}

const STATUS_LABELS: Record<AudioFeatureProviderOption["status"], string> = {
  available: "Available",
  unavailable: "Unavailable",
  checking: "Checking availability",
  unknown: "Status unavailable",
};

export function FeatureProviderPicker({
  providers,
  selectedId,
  onChange,
  disabled = false,
  coverage,
}: FeatureProviderPickerProps) {
  const orderedProviders = [...providers].sort(
    (left, right) =>
      Number(right.id === "reccobeats") - Number(left.id === "reccobeats"),
  );

  return (
    <fieldset>
      <legend className="sr-only">Choose an audio feature backend</legend>
      <div className="grid gap-2 md:grid-cols-2">
        {orderedProviders.map((provider) => {
          const selected = provider.id === selectedId;
          const unavailable = provider.status === "unavailable";
          const descriptionId = `feature-provider-${provider.id}-description`;

          return (
            <label
              key={provider.id}
              className={`feature-provider ${selected ? "selected" : ""} ${unavailable ? "unavailable" : ""}`}
            >
              <input
                className="sr-only"
                type="radio"
                name="feature-provider"
                value={provider.id}
                checked={selected}
                disabled={unavailable || disabled}
                onChange={() => onChange(provider.id)}
                aria-describedby={descriptionId}
              />
              <span className="flex items-start justify-between gap-3">
                <span>
                  <span className="block font-display text-sm font-semibold text-white/90">
                    {provider.display_name}
                  </span>
                  <span className="mt-1 block text-[10px] uppercase tracking-[0.12em] text-mist/45">
                    {provider.requires_local_audio ? "Local audio analysis" : "Catalog feature lookup"}
                  </span>
                </span>
                <span className={`provider-availability ${provider.status}`}>
                  <span aria-hidden="true" />
                  {STATUS_LABELS[provider.status]}
                </span>
              </span>
              <span
                id={descriptionId}
                className="mt-4 block text-xs leading-5 text-mist/60"
              >
                {provider.detail}
              </span>
              <span className="mt-3 flex items-center justify-between gap-3 border-t border-line/70 pt-3 text-[10px] text-mist/45">
                <span>
                  {selected && coverage
                    ? `${coverage.matched} matched · ${coverage.unresolved} unresolved`
                    : provider.requires_local_audio
                      ? "Requires MP3, FLAC, or WAV files"
                      : "Coverage varies by catalog"}
                </span>
                {provider.id === "reccobeats" && (
                  <span className="shrink-0 text-acid/75">Test first</span>
                )}
                {unavailable && provider.id === "essentia" && (
                  <span className="shrink-0 text-amber-100/60">Setup needed</span>
                )}
              </span>
              {selected && !coverage && (
                <span className="mt-2 block text-[10px] leading-4 text-mist/40">
                  Unresolved tracks stay in the playlist and are marked as missing feature data.
                </span>
              )}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
