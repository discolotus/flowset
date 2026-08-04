import {
  NUMERIC_PARAMETERS,
  parameterDescription,
  parameterInterpretation,
  parameterLabel,
  parameterUnit,
} from "../lib/parameters";
import type { NumericParameter } from "../lib/types";

export function ParameterGuide({ parameter }: { parameter: NumericParameter }) {
  return (
    <div className="parameter-guide">
      <div className="parameter-guide-current">
        <div>
          <span className="parameter-guide-label">What {parameterLabel(parameter).toLowerCase()} means</span>
          <p>{parameterDescription(parameter)}</p>
          <small>{parameterInterpretation(parameter)}</small>
        </div>
        {parameterUnit(parameter) && <strong>{parameterUnit(parameter)}</strong>}
      </div>

      <details className="parameter-glossary">
        <summary>Browse all parameter definitions</summary>
        <div className="parameter-glossary-grid">
          {NUMERIC_PARAMETERS.map((item) => (
            <article key={item.value} className={item.value === parameter ? "selected" : ""}>
              <header>
                <h3>{item.label}</h3>
                {item.unit && <span>{item.unit}</span>}
              </header>
              <p>{item.description}</p>
              <small>{item.interpretation}</small>
            </article>
          ))}
        </div>
        <p className="parameter-glossary-note">
          Score meanings and raw magnitudes are provider-specific. Compare tracks analyzed by the
          same backend; Flowset keeps unavailable measurements visibly disabled.
        </p>
      </details>
    </div>
  );
}
