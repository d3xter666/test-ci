#!/usr/bin/env node

/**
 * check-engine-compat.mjs
 *
 * Checks whether all installed dependencies' "engines" fields
 * are compatible with the project's own declared engine ranges.
 *
 * This is a STATIC range-vs-range check:
 *   "Does the dependency support ALL Node versions the project claims to support?"
 *
 * Usage:
 *   node check-engine-compat.mjs [options]
 *
 * Options:
 *   --mode=warn|error     Exit 0 (warn) or 1 (error) on conflicts (default: error)
 *   --exclude=pkg1,pkg2   Comma-separated package names or glob patterns to skip
 *   --config=path          Path to JSON config file (default: .engine-compat.json)
 *   --json                 Output results as JSON
 *   --check-node           Check engines.node (default: true)
 *   --check-npm            Check engines.npm (default: false)
 *   --no-check-node        Disable engines.node check
 *   --prod-only            Only check production dependencies (skip devDependencies)
 */

import {readFileSync, readdirSync, existsSync, statSync} from "node:fs";
import {join, resolve} from "node:path";
import {createRequire} from "node:module";
import {parseArgs} from "node:util";

// Use project-local semver
const require = createRequire(import.meta.url);
const semver = require("semver");

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

const {values: cliArgs, tokens: cliTokens} = parseArgs({
	options: {
		mode: {type: "string"},
		exclude: {type: "string"},
		config: {type: "string", default: ".engine-compat.json"},
		json: {type: "boolean", default: false},
		"check-node": {type: "boolean"},
		"check-npm": {type: "boolean"},
		"prod-only": {type: "boolean"},
	},
	strict: false,
	tokens: true,
});

// ---------------------------------------------------------------------------
// Config loading (CLI args override config file)
// ---------------------------------------------------------------------------

function loadConfig(configPath) {
	const defaults = {
		mode: "error",
		exclude: [],
		checkNode: true,
		checkNpm: false,
		prodOnly: false,
	};

	let fileConfig = {};
	const resolvedPath = resolve(configPath);
	if (existsSync(resolvedPath)) {
		try {
			fileConfig = JSON.parse(readFileSync(resolvedPath, "utf8"));
		} catch (e) {
			console.error(`Warning: Could not parse config file ${resolvedPath}: ${e.message}`);
		}
	}

	// CLI args that were explicitly passed (not defaults)
	const explicitCli = new Set(
		(cliTokens || []).filter((t) => t.kind === "option").map((t) => t.name)
	);

	function pick(cliKey, fileKey, defaultVal) {
		if (explicitCli.has(cliKey)) return cliArgs[cliKey];
		if (fileConfig[fileKey] !== undefined) return fileConfig[fileKey];
		return defaultVal;
	}

	const excludeRaw = pick("exclude", "exclude", defaults.exclude);

	return {
		mode: pick("mode", "mode", defaults.mode),
		exclude: typeof excludeRaw === "string"
			? excludeRaw.split(",").map((s) => s.trim()).filter(Boolean)
			: Array.isArray(excludeRaw) ? excludeRaw : defaults.exclude,
		checkNode: pick("check-node", "checkNode", defaults.checkNode),
		checkNpm: pick("check-npm", "checkNpm", defaults.checkNpm),
		prodOnly: pick("prod-only", "prodOnly", defaults.prodOnly),
		json: cliArgs.json ?? false,
	};
}

// ---------------------------------------------------------------------------
// Package name matching (supports glob-like patterns with minimatch if available)
// ---------------------------------------------------------------------------

function matchesExclude(packageName, excludePatterns) {
	for (const pattern of excludePatterns) {
		if (pattern === packageName) return true;
		// Simple wildcard: @types/* matches @types/node, @types/foo, etc.
		if (pattern.includes("*")) {
			const regex = new RegExp(
				"^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$"
			);
			if (regex.test(packageName)) return true;
		}
	}
	return false;
}

// ---------------------------------------------------------------------------
// Core: walk node_modules and collect dependency engine info
// ---------------------------------------------------------------------------

function collectDependencies(projectDir) {
	const nodeModulesDir = join(projectDir, "node_modules");
	if (!existsSync(nodeModulesDir)) {
		throw new Error(`node_modules not found in ${projectDir}. Run npm install first.`);
	}

	const deps = [];

	function readPkg(pkgDir, name) {
		const pkgJsonPath = join(pkgDir, "package.json");
		if (!existsSync(pkgJsonPath)) return;
		try {
			const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
			deps.push({
				name: pkg.name || name,
				version: pkg.version,
				engines: pkg.engines || {},
				path: pkgDir,
			});
		} catch {
			// Skip unreadable packages
		}
	}

	function walkNodeModules(nmDir) {
		if (!existsSync(nmDir)) return;
		let entries;
		try {
			entries = readdirSync(nmDir, {withFileTypes: true});
		} catch {
			return;
		}

		for (const entry of entries) {
			if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
			if (entry.name === ".package-lock.json" || entry.name === ".cache") continue;

			const fullPath = join(nmDir, entry.name);

			if (entry.name.startsWith("@")) {
				// Scoped package: read subdirectories
				let scopedEntries;
				try {
					scopedEntries = readdirSync(fullPath, {withFileTypes: true});
				} catch {
					continue;
				}
				for (const scopedEntry of scopedEntries) {
					if (!scopedEntry.isDirectory() && !scopedEntry.isSymbolicLink()) continue;
					const scopedPath = join(fullPath, scopedEntry.name);
					const scopedName = `${entry.name}/${scopedEntry.name}`;
					readPkg(scopedPath, scopedName);
					// Also walk nested node_modules
					walkNodeModules(join(scopedPath, "node_modules"));
				}
			} else {
				readPkg(fullPath, entry.name);
				// Walk nested node_modules
				walkNodeModules(join(fullPath, "node_modules"));
			}
		}
	}

	walkNodeModules(nodeModulesDir);
	return deps;
}

// ---------------------------------------------------------------------------
// Core: Check engine compatibility (range-vs-range)
// ---------------------------------------------------------------------------

/**
 * Check if projectRange is a subset of depRange.
 * i.e., every version the project supports is also supported by the dep.
 *
 * @param {string} projectRange - e.g. "^22.20.0 || >=24.0.0"
 * @param {string} depRange - e.g. ">=18"
 * @returns {{compatible: boolean, details: string}}
 */
function checkRangeCompat(projectRange, depRange) {
	if (!depRange || depRange === "*") {
		return {compatible: true, details: "No constraint (any version)"};
	}

	// Validate ranges
	const projValid = semver.validRange(projectRange);
	const depValid = semver.validRange(depRange);

	if (!projValid) {
		return {compatible: false, details: `Invalid project range: ${projectRange}`};
	}
	if (!depValid) {
		return {compatible: false, details: `Invalid dep range: ${depRange}`};
	}

	// Check if project range is a subset of dep range
	// i.e., all versions the project supports are also supported by the dep
	const isSubset = semver.subset(projectRange, depRange);

	if (isSubset) {
		return {compatible: true, details: "Fully compatible"};
	}

	// Find which parts of the project range are NOT covered
	// Split project range into individual comparator sets (OR groups)
	const projectParts = projectRange.split("||").map((s) => s.trim());
	const uncoveredParts = [];

	for (const part of projectParts) {
		if (!semver.subset(part, depRange)) {
			uncoveredParts.push(part);
		}
	}

	const details = uncoveredParts.length > 0
		? `Project range "${uncoveredParts.join(" || ")}" not covered by dep range "${depRange}"`
		: `Ranges not fully compatible: project "${projectRange}" vs dep "${depRange}"`;

	return {compatible: false, details};
}

function getProductionDeps(projectDir) {
	const pkgPath = join(projectDir, "package.json");
	const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
	return new Set([
		...Object.keys(pkg.dependencies || {}),
		...Object.keys(pkg.peerDependencies || {}),
	]);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
	const projectDir = process.cwd();
	const config = loadConfig(cliArgs.config ?? ".engine-compat.json");

	// Read project engines
	const projectPkgPath = join(projectDir, "package.json");
	if (!existsSync(projectPkgPath)) {
		console.error("No package.json found in current directory");
		process.exit(1);
	}

	const projectPkg = JSON.parse(readFileSync(projectPkgPath, "utf8"));
	const projectEngines = projectPkg.engines || {};

	if (!projectEngines.node && !projectEngines.npm) {
		console.log("No engines declared in project package.json. Nothing to check.");
		process.exit(0);
	}

	function printHeader() {
		console.log(`\nProject: ${projectPkg.name || "unnamed"}`);
		if (projectEngines.node) {
			console.log(`  engines.node: ${projectEngines.node}`);
		}
		if (projectEngines.npm) {
			console.log(`  engines.npm:  ${projectEngines.npm}`);
		}
		console.log(`  Mode: ${config.mode}`);
		if (config.exclude.length) {
			console.log(`  Excludes: ${config.exclude.join(", ")}`);
		}
		console.log("");
	}

	// Collect deps
	const allDeps = collectDependencies(projectDir);

	// Filter to prod-only if requested
	let depsToCheck = allDeps;
	if (config.prodOnly) {
		const prodNames = getProductionDeps(projectDir);
		// Keep deps whose name is in prodNames (direct), plus all transitive
		// For simplicity, we still check all — true prod-only would require tree resolution
		// Instead, we mark which are direct prod deps and only report those
		depsToCheck = allDeps.filter((d) => prodNames.has(d.name));
	}

	const conflicts = [];
	const compatible = [];
	const excluded = [];
	const noEngine = [];

	for (const dep of depsToCheck) {
		// Check excludes
		if (matchesExclude(dep.name, config.exclude)) {
			excluded.push(dep);
			continue;
		}

		let hasConflict = false;
		const depConflicts = {
			name: dep.name,
			version: dep.version,
			engines: dep.engines,
			issues: [],
		};

		// Check node
		if (config.checkNode && projectEngines.node) {
			if (!dep.engines.node) {
				noEngine.push({...dep, field: "node"});
			} else {
				const result = checkRangeCompat(projectEngines.node, dep.engines.node);
				if (!result.compatible) {
					hasConflict = true;
					depConflicts.issues.push({
						field: "node",
						depRange: dep.engines.node,
						projectRange: projectEngines.node,
						details: result.details,
					});
				}
			}
		}

		// Check npm
		if (config.checkNpm && projectEngines.npm) {
			if (!dep.engines.npm) {
				// npm engine not specified — fine
			} else {
				const result = checkRangeCompat(projectEngines.npm, dep.engines.npm);
				if (!result.compatible) {
					hasConflict = true;
					depConflicts.issues.push({
						field: "npm",
						depRange: dep.engines.npm,
						projectRange: projectEngines.npm,
						details: result.details,
					});
				}
			}
		}

		if (hasConflict) {
			conflicts.push(depConflicts);
		} else if (dep.engines.node || dep.engines.npm) {
			compatible.push(dep);
		}
	}

	// ---------------------------------------------------------------------------
	// Output
	// ---------------------------------------------------------------------------

	if (config.json) {
		const output = {
			project: {
				name: projectPkg.name,
				engines: projectEngines,
			},
			mode: config.mode,
			summary: {
				total: depsToCheck.length,
				compatible: compatible.length,
				conflicts: conflicts.length,
				noEngine: noEngine.length,
				excluded: excluded.length,
			},
			conflicts,
			excluded: excluded.map((d) => ({name: d.name, version: d.version})),
		};
		// In JSON mode, only output JSON (no header text)
		console.log(JSON.stringify(output, null, 2));

		if (conflicts.length > 0 && config.mode === "error") {
			process.exit(1);
		}
		process.exit(0);
	}

	// Human-readable output below
	{
		printHeader();
		// Human-readable output
		console.log(`Checked ${depsToCheck.length} packages:\n`);
		console.log(`  ✅ ${compatible.length} compatible (have engines, all OK)`);
		console.log(`  ⬜ ${noEngine.length} no engines.node declared`);
		if (excluded.length) {
			console.log(`  ⏭️  ${excluded.length} excluded`);
		}

		if (conflicts.length === 0) {
			console.log(`\n  ✅ No engine conflicts found!\n`);
		} else {
			console.log(`  ❌ ${conflicts.length} conflicts:\n`);

			// Table header
			const nameWidth = Math.max(20, ...conflicts.map((c) => `${c.name}@${c.version}`.length)) + 2;
			const rangeWidth = 25;

			console.log(
				`  ${"Package".padEnd(nameWidth)} ${"Dep engines.node".padEnd(rangeWidth)} Conflict`
			);
			console.log(`  ${"─".repeat(nameWidth)} ${"─".repeat(rangeWidth)} ${"─".repeat(50)}`);

			for (const conflict of conflicts) {
				for (const issue of conflict.issues) {
					const pkg = `${conflict.name}@${conflict.version}`;
					console.log(
						`  ${pkg.padEnd(nameWidth)} ${(issue.depRange || "n/a").padEnd(rangeWidth)} ${issue.details}`
					);
				}
			}
			console.log("");
		}
	}

	// Exit code
	if (conflicts.length > 0 && config.mode === "error") {
		process.exit(1);
	}
	process.exit(0);
}

main();
