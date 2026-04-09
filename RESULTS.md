# Engine Compatibility Checker — Tool Evaluation Results

**Date**: 8 April 2026
**Test project engines**: `"node": "^22.20.0 || >=24.0.0"`, `"npm": ">= 8"`
**Node versions tested**: 20.17.0 (outside range), 22.21.1 (in range), 24.13.0 (in range)

## Known Test Conflicts
  
| Package | engines.node | Conflict Reason |
|---|---|---|
| `fake-old-dep@2.0.0` | `^20` | Doesn't cover 22 or 24 |
| `fake-restricted-dep@1.0.0` | `>=18 <24` | Doesn't cover >=24 |
| `ls-engines@0.10.0` | `^22.21 \|\| ^24.12 \|\| >= 25.2` | Doesn't cover ^22.20.0 or >=24 before 24.12 |
| `get-dep-tree@3.0.0` | `^22.21 \|\| ^24.12 \|\| >= 25.2` | Same as ls-engines |
| `pargs@1.3.1` | `^22.20 \|\| ^24.10 \|\| >= 25` | Doesn't cover >=24 before 24.10 |

## Core Question: Range-vs-Range Checking?

| Tool | Range-vs-range? | Node version independent? |
|---|---|---|
| `npm --engine-strict` | No — running Node vs dep engines | No |
| `check-engine` | No — running Node vs **root** engines only | No |
| `ls-engines` | **Yes** — compares project range vs dep graph range | Yes |
| `check-engine-light` | **Yes** — uses `semver.subset()` | Yes |
| Custom script | **Yes** — uses `semver.subset()` | Yes |

## Conflicts Detected (prod deps only, Node 22.21.1)

| Tool | fake-old-dep | fake-restricted-dep | ls-engines deps* | Exit code |
|---|---|---|---|---|
| `npm --engine-strict` | Catches (runtime) | Misses! | Misses | 1 |
| `check-engine` | Misses | Misses | Misses | 0 |
| `ls-engines` | Catches | Catches | Misses (prod only) | 0 |
| `check-engine-light` | Catches | Catches | Misses (prod only) | 1 |
| Custom script | Catches | Catches | Misses (prod only) | 1 |

*ls-engines/get-dep-tree/pargs are devDeps — only detected with `--dev`

## With --dev Flag (includes devDependencies)

| Tool | Total conflicts | Details |
|---|---|---|
| `ls-engines --dev` | 5 | fake-old-dep, fake-restricted-dep, get-dep-tree, ls-engines, pargs |
| `check-engine-light --dev` | 5 | Same 5 |
| Custom script (all deps) | 5 | Same 5 |

## Consistency Across Node Versions

| Tool | Node 20 | Node 22 | Node 24 | Identical? |
|---|---|---|---|---|
| `npm --engine-strict` | Fail (root mismatch) | Fail (fake-old-dep) | Fail (fake-old-dep) | No — different reasons |
| `check-engine` | Fail (root mismatch) | Pass | Pass | No — runtime dependent |
| `ls-engines` | Crashes (needs >=22) | 2 conflicts | 2 conflicts | Yes (when it runs) |
| `check-engine-light` | 2 conflicts | 2 conflicts | 2 conflicts | Yes — identical |
| Custom script | 5 conflicts | 5 conflicts | 5 conflicts | Yes — identical |

## Feature Comparison

| Feature | `npm --engine-strict` | `check-engine` | `ls-engines` | `check-engine-light` | Custom script |
|---|---|---|---|---|---|
| Range-vs-range check | No | No | Yes | Yes | Yes |
| Node-version independent | No | No | Yes | Yes | Yes |
| Reads from lockfile | Yes | No | Yes (virtual mode) | Yes | No (node_modules) |
| Reads from node_modules | Yes | Yes | Yes (actual mode) | No | Yes |
| Exclude packages | No | No | No | No | Yes |
| Warn mode (exit 0) | No | No | Yes (always 0) | No | Yes |
| Error mode (exit 1) | Yes (always) | Yes (always) | No (always 0) | Yes (always) | Yes |
| JSON output | No | No | No | No | Yes |
| Config file | No | No | No | No | Yes |
| Glob exclude patterns | No | No | No | No | Yes |
| Workspace support | No | No | Yes | Yes (`-w`) | No (root only) |
| npm engine check | Yes | Yes | No | Yes (`-e npm`) | Yes (`--check-npm`) |
| Actively maintained | Yes (npm) | Stale | Yes (ljharb) | Yes (textbook) | You own it |
| Zero extra deps | Yes | No | No (297 deps!) | No (few deps) | Yes (uses project's semver) |

## Raw Output: npm --engine-strict

### Node 22.21.1

```
npm error code EBADENGINE
npm error engine Unsupported engine
npm error engine Not compatible with your version of node/npm: fake-old-dep@2.0.0
npm error notsup Required: {"node":"^20"}
npm error notsup Actual:   {"npm":"10.9.4","node":"v22.21.1"}
Exit: 1
```

### Node 24.13.0

```
npm error code EBADENGINE
npm error engine Unsupported engine
npm error engine Not compatible with your version of node/npm: fake-old-dep@2.0.0
npm error notsup Required: {"node":"^20"}
npm error notsup Actual:   {"npm":"11.6.2","node":"v24.13.0"}
Exit: 1
```

### Node 20.17.0

```
npm error code EBADENGINE
npm error engine Unsupported engine
npm error engine Not compatible with your version of node/npm: engine-compat-test@1.0.0
npm error notsup Required: {"node":"^22.20.0 || >=24.0.0","npm":">= 8"}
npm error notsup Actual:   {"npm":"10.8.2","node":"v20.17.0"}
Exit: 1
```

## Raw Output: check-engine

### Node 22.21.1

```
Checking versions...
✔ node was validated with ^22.20.0 || >=24.0.0.
✔ npm was validated with >= 8.
Environment looks good!
Exit: 0
```

### Node 20.17.0

```
Checking versions...
✘ node version is incorrect! Expected ^22.20.0 || >=24.0.0 but was v20.17.0.
✔ npm was validated with >= 8.
Environment is invalid!
Exit: 1
```

## Raw Output: ls-engines

### Node 22.21.1 (--mode actual, prod only)

```
┌───────────────────────────────────┬───────────────────────────┐
│ package engines:                  │ dependency graph engines: │
├───────────────────────────────────┼───────────────────────────┤
│ "engines": {                      │ "engines": {              │
│   "node": "^22.20.0 || >= 24.0.0" │   "node": "*"             │
│ }                                 │ }                         │
└───────────────────────────────────┴───────────────────────────┘

Your "engines" field allows fewer node versions than your dependency graph does.

┌──────────────────────────────┬──────────────┐
│ Conflicting dependencies (2) │ engines.node │
├──────────────────────────────┼──────────────┤
│ fake-old-dep                 │ ^20          │
├──────────────────────────────┼──────────────┤
│ fake-restricted-dep          │ >=18 <24     │
└──────────────────────────────┴──────────────┘
Exit: 0
```

### Node 22.21.1 (--mode actual --dev, includes devDeps)

```
┌──────────────────────────────┬─────────────────────────────┐
│ Conflicting dependencies (5) │ engines.node                │
├──────────────────────────────┼─────────────────────────────┤
│ fake-old-dep                 │ ^20                         │
├──────────────────────────────┼─────────────────────────────┤
│ fake-restricted-dep          │ >=18 <24                    │
├──────────────────────────────┼─────────────────────────────┤
│ get-dep-tree                 │ ^22.21 || ^24.12 || >= 25.2 │
├──────────────────────────────┼─────────────────────────────┤
│ ls-engines                   │ ^22.21 || ^24.12 || >= 25.2 │
├──────────────────────────────┼─────────────────────────────┤
│ pargs                        │ ^22.20 || ^24.10 || >= 25   │
└──────────────────────────────┴─────────────────────────────┘
Exit: 0
```

### Node 20.17.0

```
TypeError: groupBy is not a function
Exit: 1
```

ls-engines itself requires Node >=22 (`Object.groupBy` not available in Node 20).

### Node 24.13.0

Same output as Node 22.21.1 — identical conflicts detected.

## Raw Output: check-engine-light

### Node 22.21.1 (prod only)

```
fake-old-dep { node: '^20' } incompatible with { node: '^22.20.0 || >=24.0.0' }
fake-restricted-dep { node: '>=18 <24' } incompatible with { node: '^22.20.0 || >=24.0.0' }
Error: incompatible dependencies: fake-old-dep, fake-restricted-dep
Exit: 1
```

### Node 24.13.0 (with --dev)

```
fake-old-dep { node: '^20' } incompatible with { node: '^22.20.0 || >=24.0.0' }
fake-restricted-dep { node: '>=18 <24' } incompatible with { node: '^22.20.0 || >=24.0.0' }
get-dep-tree { node: '^22.21 || ^24.12 || >= 25.2' } incompatible with { node: '^22.20.0 || >=24.0.0' }
ls-engines { node: '^22.21 || ^24.12 || >= 25.2' } incompatible with { node: '^22.20.0 || >=24.0.0' }
pargs { node: '^22.20 || ^24.10 || >= 25' } incompatible with { node: '^22.20.0 || >=24.0.0' }
Error: incompatible dependencies: fake-old-dep, fake-restricted-dep, get-dep-tree, ls-engines, pargs
Exit: 1
```

### Node 20.17.0

Same output as Node 22 — identical results regardless of running Node version.

## Raw Output: Custom Script

### Node 22.21.1 (all deps scanned)

```
Project: engine-compat-test
  engines.node: ^22.20.0 || >=24.0.0
  engines.npm:  >= 8
  Mode: error

Checked 343 packages:

  ✅ 286 compatible (have engines, all OK)
  ⬜ 52 no engines.node declared
  ❌ 5 conflicts:

  Package                     Dep engines.node          Conflict
  ─────────────────────────── ───────────────────────── ──────────────────────────────────────────────────
  fake-old-dep@2.0.0          ^20                       Project range "^22.20.0 || >=24.0.0" not covered by dep range "^20"
  fake-restricted-dep@1.0.0   >=18 <24                  Project range ">=24.0.0" not covered by dep range ">=18 <24"
  get-dep-tree@3.0.0          ^22.21 || ^24.12 || >= 25.2 Project range "^22.20.0 || >=24.0.0" not covered by dep range "^22.21 || ^24.12 || >= 25.2"
  ls-engines@0.10.0           ^22.21 || ^24.12 || >= 25.2 Project range "^22.20.0 || >=24.0.0" not covered by dep range "^22.21 || ^24.12 || >= 25.2"
  pargs@1.3.1                 ^22.20 || ^24.10 || >= 25 Project range ">=24.0.0" not covered by dep range "^22.20 || ^24.10 || >= 25"

Exit: 1
```

Output is **identical** on Node 20, 22, and 24.

## Real-World Test: ui5-cli-mono (1406 packages)

```
Project: @ui5/cli-monorepo
  engines.node: ^22.20.0 || >=24.0.0
  engines.npm:  >= 8
  Mode: error

Checked 1406 packages:

  ✅ 980 compatible (have engines, all OK)
  ⬜ 426 no engines.node declared

  ✅ No engine conflicts found!
Exit: 0
```

## Implementation Details

### check-engine-light

- **Source**: `github.com/textbook/check-engine-light`
- **Version tested**: 0.4.0
- **Approach**: Reads `package-lock.json`, uses `semver.subset(projectRange, depRange)` from [compare.js](node_modules/check-engine-light/lib/compare.js)
- **Strengths**: Lockfile-based (no npm install needed), lightweight, workspace support
- **Weaknesses**: No exclude list, no warn mode (always throws on conflict), no JSON output, no config file

### ls-engines

- **Source**: `github.com/ljharb/ls-engines`
- **Version tested**: 0.10.0
- **Approach**: Uses `@npmcli/arborist` to load dep tree, compares range-vs-range
- **Strengths**: Multiple modes (actual/virtual/ideal), nice table output, `--save` can update engines
- **Weaknesses**: Always exits 0 (can't fail pipeline), 297 transitive deps, requires Node >=22

### Custom script (check-engine-compat.mjs)

- **Approach**: Walks `node_modules/**/package.json`, uses `semver.subset(projectRange, depRange)`
- **Strengths**: Exclude patterns (exact + glob), warn/error mode, JSON output, config file, zero deps beyond semver
- **Weaknesses**: Requires `node_modules` (post-install), no lockfile mode, no workspace root selection

## Recommendation

| Use Case | Best Tool |
|---|---|
| CI pipeline with exclude/warn support for dependabot | **Custom script** or **check-engine-light + wrapper** |
| Quick one-off check (no customization needed) | **check-engine-light** |
| Informational overview with nice formatting | **ls-engines** |
| Simple "does my current Node match root engines?" | **check-engine** |

### Suggested CI Integration

```yaml
- name: Check engine compatibility
  run: node scripts/check-engine-compat.mjs --mode=${{ github.actor == 'dependabot[bot]' && 'warn' || 'error' }}
```

Or with check-engine-light (no exclude/warn mode):

```yaml
- name: Check engine compatibility
  run: npx check-engine-light .
  continue-on-error: ${{ github.actor == 'dependabot[bot]' }}
```
