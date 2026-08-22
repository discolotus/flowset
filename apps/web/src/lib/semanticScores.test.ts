import { expect, it } from "vitest";
import { mergeSemanticScores } from "../App";

const score = (key: string, value: number) => ({ key, label: key, normalized_label: key, score: value, provenance: { backend: "test", model: "test" } });

it("merges semantic scores by key and replaces only an updated key", () => {
  expect(mergeSemanticScores([score("first", 0.2), score("same", 0.1)], [score("same", 0.9), score("second", 0.8)])).toEqual([
    score("first", 0.2), score("same", 0.9), score("second", 0.8),
  ]);
});
