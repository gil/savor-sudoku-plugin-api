export interface EngineDifficulty {
  /** Stable within the engine. Persisted. Never reused for a different level. */
  readonly id: string;
  /** Menu text. */
  readonly label: string;
  /** Sort key. Ascending = easier first. */
  readonly order: number;
  /** Optional tag. The built-in engine marks its six lessons "lesson". */
  readonly group?: string;
}

export type Capability = "generate" | "rate" | "hint";

export interface EngineManifest {
  /** Globally unique across the registry. Persisted. */
  readonly id: string;
  readonly name: string;
  readonly version: string;
  /** SPDX identifier. */
  readonly license: string;
  readonly capabilities: readonly Capability[];
  /** Empty unless "generate" is declared. At most 12 entries. */
  readonly difficulties: readonly EngineDifficulty[];
  /** Required when "hint" is declared. At most 500 entries. */
  readonly techniques?: readonly EngineTechnique[];
}

export interface GenerateRequest {
  readonly difficultyId: string;
  /** The provider builds its own PRNG from this. Same seed, same givens. */
  readonly seed: number;
}

export interface GenerateResult {
  /** Exactly 81 chars, [1-9] for a given and '.' for empty. */
  readonly givens: string;
}

export interface EngineProvider {
  manifest(): EngineManifest;
  generate(req: GenerateRequest): Promise<GenerateResult> | GenerateResult;
  rate?(req: RateRequest): Promise<RateResult> | RateResult;
  hint?(req: HintRequest): Promise<HintResult | null> | HintResult | null;
}

/** One entry in an engine's technique repertoire. */
export interface EngineTechnique {
  /** Engine-scoped and stable. Never persisted by the host. */
  readonly id: string;
  readonly name: string;
  /** Omitted when no reference page exists. Must be https: when present. */
  readonly url?: string;
}

export interface RateRequest {
  /** Exactly 81 chars, [1-9] for a given and '.' for empty. */
  readonly givens: string;
}

export interface RateResult {
  /** false = this engine declines to rate this grid. Not an error. */
  readonly ok: boolean;
  /**
   * Header text, by convention "<name>: <score>": "Fiendish: 374" | "ER: 8.3".
   * Empty only when !ok.
   */
  readonly label: string;
  /** Modal only, for anything the label leaves out: "EP 8.3 / ED 7.1". */
  readonly detail?: string;
}

export type HintColor = "yellow" | "green" | "red" | "blue" | "white";

export interface HintRequest {
  /**
   * Exactly 81 chars of [1-9.]: the current board including the player's
   * placements.
   */
  readonly grid: string;
  /**
   * 81 nine-bit masks, one per cell: bit d-1 set = digit d+1 is a candidate.
   * Absent when the host has no marks to offer, and an engine that ignores it
   * derives its own candidates as before.
   *
   * A filled cell's mask is 0. Every empty cell carries a non-zero mask: the
   * host substitutes basic peer elimination for cells the player left blank, so
   * a set that arrives here is complete. Without this an elimination-only hint
   * repeats forever, because applying it changes only the marks and `grid`
   * comes back identical.
   */
  readonly candidates?: readonly number[];
}

export interface HintPlacement {
  /** 0..80, row-major. */
  readonly cell: number;
  /** 1..9. */
  readonly digit: number;
}

export interface HintCellHighlight {
  readonly cell: number;
  readonly color: HintColor;
}

export interface HintCandidateHighlight {
  readonly cell: number;
  readonly digit: number;
  readonly color: HintColor;
}

export interface HintHouseHighlight {
  /** 0..8 rows, 9..17 columns, 18..26 blocks. */
  readonly house: number;
  readonly color: HintColor;
}

export interface HintHighlights {
  readonly cells?: readonly HintCellHighlight[];
  readonly candidates?: readonly HintCandidateHighlight[];
  readonly houses?: readonly HintHouseHighlight[];
}

export interface HintResult {
  /** Must appear in manifest.techniques; the host rejects anything else. */
  readonly techniqueId: string;
  /** One-line explanation. */
  readonly text: string;
  /**
   * The long form of `text`, in Markdown, shown when the player asks to learn
   * about the step. Omit it and the Learn button falls back to the technique's
   * reference URL, as before.
   *
   * Raw HTML passes through to the pane unchanged, so an engine that colors its
   * prose can lead with its own `<style>` block. Keep the selectors narrow: the
   * block is live for as long as the explanation is on screen.
   */
  readonly explanation?: string;
  readonly placements: readonly HintPlacement[];
  readonly eliminations: readonly HintPlacement[];
  readonly highlights: HintHighlights;
}
