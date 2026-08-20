# savor-sudoku-plugin-api

The contract a Savor Sudoku engine plugin implements, plus both halves of the
RPC that carries it. MIT licensed, so a plugin may be released under any
license.

A plugin is a **self-contained ESM worker bundle**. The app never imports plugin
code into its own realm; it spawns a worker from a URL and posts messages.
Separate thread, separate realm, plain structured-cloneable data only.

## Writing a provider

```ts
import { serve, type EngineProvider } from "savor-sudoku-plugin-api";

const provider: EngineProvider = {
  manifest: () => ({
    id: "my-engine",
    name: "My Engine",
    version: "0.1.0",
    license: "MIT",
    capabilities: ["generate"],
    difficulties: [
      { id: "easy", label: "Easy", order: 0 },
      { id: "hard", label: "Hard", order: 1 },
    ],
  }),
  generate: ({ difficultyId, seed }) => ({
    givens: myGenerator(difficultyId, seed), // exactly 81 chars of [1-9.]
  }),
};

serve(provider);
```

Build it to a single ESM file with every dependency inlined and no external
imports, then serve that file at a stable, version-stamped URL.

## Rules

- `generate` returns **givens only**, exactly 81 characters matching
  `/^[1-9.]{81}$/`, `.` for an empty cell. The host derives the solution.
- The same `seed` must produce the same givens. Build your PRNG from it.
- Difficulty ids are stable and persisted. Never reuse an id for a different
  level.
- A manifest declaring `generate` must list at least one difficulty, and at
  most **12**.
- `rate` and `hint` are optional. Declare the capability and implement the
  matching method, or leave both out.
- Long work stays inside the worker. There are no progress or cancel callbacks
  across the boundary; the host cancels by terminating the worker.

## Optional: rating

Declare `"rate"` in `capabilities` and implement `rate`:

```ts
rate({ givens }) {
  const score = myEngine.rate(givens);
  if (score === null) return { ok: false, label: "" };
  return { ok: true, label: `ER ${score.er}`, detail: `EP ${score.ep}` };
}
```

`ok: false` is a decline, not an error — plenty of engines refuse to rate a
puzzle they cannot fully solve. `label` is what the play header shows; `detail`
is extra text the cross-engine comparison modal shows and nothing else.

## Optional: hints

Declare `"hint"` in `capabilities`, list your repertoire in `techniques`, and
implement `hint`:

```ts
const TECHNIQUES = [
  { id: "naked-single", name: "Naked Single", url: "https://example.org/ns" },
  { id: "x-wing", name: "X-Wing" },
];

hint({ grid }) {
  const step = myEngine.nextStep(grid);
  if (!step) return null;
  return {
    techniqueId: "naked-single",
    text: "r5c5 can only be 5.",
    placements: [{ cell: 40, digit: 5 }],
    eliminations: [],
    highlights: { cells: [{ cell: 40, color: "green" }] },
  };
}
```

Rules the host enforces at the boundary, before anything touches the player's
board:

- `techniques` is required when `hint` is declared, non-empty, at most 500
  entries, with unique non-empty ids and names. A `url`, when present, must
  parse and use the `https:` scheme.
- `techniqueId` must appear in `techniques`. Anything else is a protocol
  violation.
- `cell` is `0..80` row-major, `digit` is `1..9`, `house` is `0..8` rows,
  `9..17` columns, `18..26` blocks.
- Returning `null` means "no step in my repertoire". The host falls through to
  its own tail; it does not substitute another engine's hint.
- Eliminations are intersected with the player's own pencil marks. You can
  remove the candidates you named and nothing else.

There is no representation for chain links (arrows between candidates); the
host does not draw them.

## Host side

```ts
import { connect } from "savor-sudoku-plugin-api";

const client = await connect("/plugins/my-engine-0.1.0.js");
const { givens } = await client.generate({ difficultyId: "easy", seed: 42 });
client.terminate();
```

Each method gets its own budget: 120s for `manifest` and `generate`, 60s for
`rate`, 20s for `hint`. An explicit `timeoutMs` overrides all of them.

`connect` returns the manifest as the plugin sent it. Validate it before you
trust it.
