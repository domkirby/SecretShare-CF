import type { Score } from "@zxcvbn-ts/core";

export interface PasswordStrength {
  score: Score;
  label: string;
  warning: string | null;
  suggestions: string[];
}

const SCORE_LABELS: Record<Score, string> = {
  0: "Very weak",
  1: "Weak",
  2: "Fair",
  3: "Strong",
  4: "Very strong",
};

// The dictionary + adjacency-graph data is a few hundred KB, so it's kept out of the
// main bundle and only fetched the first time a password actually needs scoring.
let zxcvbnPromise: Promise<(password: string) => { score: Score; feedback: { warning: string | null; suggestions: string[] } }> | null = null;

function loadZxcvbn() {
  if (!zxcvbnPromise) {
    zxcvbnPromise = Promise.all([
      import("@zxcvbn-ts/core"),
      import("@zxcvbn-ts/language-common"),
      import("@zxcvbn-ts/language-en"),
    ]).then(([core, zxcvbnCommon, zxcvbnEn]) => {
      const factory = new core.ZxcvbnFactory({
        dictionary: {
          ...zxcvbnCommon.dictionary,
          ...zxcvbnEn.dictionary,
        },
        graphs: zxcvbnCommon.adjacencyGraphs,
        translations: zxcvbnEn.translations,
      });
      return (password: string) => factory.check(password);
    });
  }
  return zxcvbnPromise;
}

export async function estimatePasswordStrength(password: string): Promise<PasswordStrength | null> {
  if (!password) return null;
  const check = await loadZxcvbn();
  const result = check(password);
  return {
    score: result.score,
    label: SCORE_LABELS[result.score],
    warning: result.feedback.warning,
    suggestions: result.feedback.suggestions,
  };
}
