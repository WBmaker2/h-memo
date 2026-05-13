#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const DEFAULTS = {
  rootDir: process.cwd(),
  rootPackagePath: "package.json",
  desktopPackagePath: path.join("apps", "desktop", "package.json"),
  tauriConfigPath: path.join("apps", "desktop", "src-tauri", "tauri.conf.json"),
  cargoTomlPath: path.join("apps", "desktop", "src-tauri", "Cargo.toml"),
  workspacePatterns: ["apps/*", "packages/*"],
  releaseTag: null,
};

export function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    rootDir: process.cwd(),
    rootPackagePath: DEFAULTS.rootPackagePath,
    desktopPackagePath: DEFAULTS.desktopPackagePath,
    tauriConfigPath: DEFAULTS.tauriConfigPath,
    cargoTomlPath: DEFAULTS.cargoTomlPath,
    workspacePatterns: [...DEFAULTS.workspacePatterns],
    releaseTag: DEFAULTS.releaseTag,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--root" || arg === "--root-dir") {
      if (i + 1 >= argv.length) {
        throw new Error(`${arg} requires a value.`);
      }
      options.rootDir = argv[i + 1];
      i += 1;
      continue;
    }

    if (arg === "--workspace-patterns") {
      if (i + 1 >= argv.length) {
        throw new Error("--workspace-patterns requires a value.");
      }
      options.workspacePatterns = argv[i + 1]
        .split(",")
        .map((pattern) => pattern.trim())
        .filter(Boolean);
      i += 1;
      continue;
    }

    if (arg.startsWith("--workspace-patterns=")) {
      options.workspacePatterns = arg
        .slice("--workspace-patterns=".length)
        .split(",")
        .map((pattern) => pattern.trim())
        .filter(Boolean);
      continue;
    }

    if (arg === "--root-package" || arg === "--root-package-path") {
      if (i + 1 >= argv.length) {
        throw new Error("--root-package requires a value.");
      }
      options.rootPackagePath = argv[i + 1];
      i += 1;
      continue;
    }

    if (
      arg === "--desktop-package" ||
      arg === "--desktop-package-path" ||
      arg === "--desktop-package-json"
    ) {
      if (i + 1 >= argv.length) {
        throw new Error(`${arg} requires a value.`);
      }
      options.desktopPackagePath = argv[i + 1];
      i += 1;
      continue;
    }

    if (arg === "--tauri-conf" || arg === "--tauri-conf-path") {
      if (i + 1 >= argv.length) {
        throw new Error("--tauri-conf requires a value.");
      }
      options.tauriConfigPath = argv[i + 1];
      i += 1;
      continue;
    }

    if (arg === "--cargo" || arg === "--cargo-toml" || arg === "--cargo-path") {
      if (i + 1 >= argv.length) {
        throw new Error("--cargo requires a value.");
      }
      options.cargoTomlPath = argv[i + 1];
      i += 1;
      continue;
    }

    if (arg === "--release-tag") {
      if (i + 1 >= argv.length) {
        throw new Error("--release-tag requires a value.");
      }
      options.releaseTag = argv[i + 1];
      i += 1;
      continue;
    }

    if (arg.startsWith("--release-tag=")) {
      options.releaseTag = arg.slice("--release-tag=".length);
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

export function resolveFilePath(cwd, filePath) {
  return path.resolve(cwd, filePath);
}

function readTextFile(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`Required file not found: ${filePath}`);
  }
  return readFileSync(filePath, "utf8");
}

export function readPackageVersion(packageJsonPath) {
  const source = readTextFile(packageJsonPath);
  const parsed = JSON.parse(source);
  if (typeof parsed.version !== "string" || parsed.version.trim() === "") {
    throw new Error(`Missing or empty version in ${packageJsonPath}`);
  }

  return {
    label: parsed.name ? `${parsed.name} package.json` : "package.json",
    source: packageJsonPath,
    version: parsed.version.trim(),
  };
}

export function readTauriVersion(configPath) {
  const source = readTextFile(configPath);
  const parsed = JSON.parse(source);
  if (typeof parsed.version !== "string" || parsed.version.trim() === "") {
    throw new Error(`Missing or empty version in ${configPath}`);
  }

  return {
    label: "tauri.conf.json",
    source: configPath,
    version: parsed.version.trim(),
  };
}

export function readCargoVersion(cargoTomlPath) {
  const source = readTextFile(cargoTomlPath);

  const lines = source.split(/\r?\n/);
  let inPackageSection = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || trimmed === "") {
      continue;
    }

    if (trimmed === "[package]") {
      inPackageSection = true;
      continue;
    }

    if (inPackageSection && trimmed.startsWith("[") && trimmed.endsWith("]")) {
      break;
    }

    if (!inPackageSection) {
      continue;
    }

    const versionMatch = trimmed.match(/^\s*version\s*=\s*"(.*?)"\s*(?:#.*)?$/);
    if (versionMatch) {
      const version = versionMatch[1].trim();
      if (version === "") {
        throw new Error(`Missing or empty version in ${cargoTomlPath}`);
      }

      return {
        label: "Cargo.toml",
        source: cargoTomlPath,
        version,
      };
    }
  }

  if (source.includes("[package]") === false) {
    throw new Error(`Missing [package] section in ${cargoTomlPath}`);
  }

  throw new Error(`Missing version in [package] section of ${cargoTomlPath}`);
}

export function discoverWorkspacePackageFiles(rootDir, patterns) {
  const discovered = [];
  const seen = new Set();

  const workspacePatterns =
    Array.isArray(patterns) && patterns.length > 0
      ? patterns
      : DEFAULTS.workspacePatterns;

  for (const pattern of workspacePatterns) {
    const wildcard = pattern.indexOf("/*");
    if (wildcard === -1) {
      const filePath = resolveFilePath(
        rootDir,
        pattern.endsWith(".json") ? pattern : path.join(pattern, "package.json")
      );
      if (existsSync(filePath)) {
        const normalized = path.normalize(filePath);
        if (!seen.has(normalized)) {
          seen.add(normalized);
          discovered.push(filePath);
        }
      }
      continue;
    }

    const baseDir = pattern.slice(0, wildcard);
    const baseDirPath = resolveFilePath(rootDir, baseDir);
    if (!existsSync(baseDirPath)) {
      continue;
    }

    const entries = readdirSync(baseDirPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .map((name) =>
        resolveFilePath(baseDirPath, path.join(name, "package.json"))
      );

    for (const entryFile of entries) {
      if (existsSync(entryFile)) {
        const normalized = path.normalize(entryFile);
        if (!seen.has(normalized)) {
          seen.add(normalized);
          discovered.push(entryFile);
        }
      }
    }
  }

  return discovered;
}

export function collectVersionEntries({
  rootDir = DEFAULTS.rootDir,
  rootPackagePath = DEFAULTS.rootPackagePath,
  desktopPackagePath = DEFAULTS.desktopPackagePath,
  tauriConfigPath = DEFAULTS.tauriConfigPath,
  cargoTomlPath = DEFAULTS.cargoTomlPath,
  workspacePatterns = DEFAULTS.workspacePatterns,
} = {}) {
  const resolvedRoot = path.resolve(rootDir);
  const rootPackage = resolveFilePath(resolvedRoot, rootPackagePath);
  const desktopPackage = resolveFilePath(resolvedRoot, desktopPackagePath);
  const tauriConfig = resolveFilePath(resolvedRoot, tauriConfigPath);
  const cargoToml = resolveFilePath(resolvedRoot, cargoTomlPath);

  const entries = [];
  const seenSources = new Set();
  const addEntry = (entry) => {
    if (!entry || !entry.source) {
      return;
    }
    const normalized = path.normalize(entry.source);
    if (seenSources.has(normalized)) {
      return;
    }
    seenSources.add(normalized);
    entries.push({ ...entry, source: normalized });
  };

  addEntry(readPackageVersion(rootPackage));
  addEntry(readPackageVersion(desktopPackage));

  const workspacePackagePaths = discoverWorkspacePackageFiles(
    resolvedRoot,
    workspacePatterns
  );
  for (const workspacePackagePath of workspacePackagePaths) {
    addEntry(readPackageVersion(workspacePackagePath));
  }

  addEntry(readTauriVersion(tauriConfig));
  addEntry(readCargoVersion(cargoToml));

  return entries;
}

export function checkVersionConsistency(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("No version entries found.");
  }

  const expected = entries[0].version;
  const mismatches = [];

  for (const entry of entries) {
    if (entry.version !== expected) {
      mismatches.push({
        ...entry,
        expected,
      });
    }
  }

  return {
    expectedVersion: expected,
    mismatches,
    allMatch: mismatches.length === 0,
  };
}

export function checkReleaseTagVersion(releaseTag, expectedVersion) {
  if (releaseTag == null || String(releaseTag).trim() === "") {
    return {
      provided: false,
      ok: true,
      releaseTag: "",
      tagVersion: "",
      expectedTag: `v${expectedVersion}`,
      failures: [],
    };
  }

  const normalizedTag = String(releaseTag).trim();
  const expectedTag = `v${expectedVersion}`;
  const failures = [];
  let tagVersion = "";

  if (!normalizedTag.startsWith("v")) {
    failures.push(
      `Release tag must start with 'v' (example: ${expectedTag}). Provided: ${normalizedTag}`
    );
  } else {
    tagVersion = normalizedTag.slice(1);
    if (tagVersion === "") {
      failures.push(
        `Release tag must include a version after 'v' (example: ${expectedTag}).`
      );
    } else if (tagVersion !== expectedVersion) {
      failures.push(
        `Release tag ${normalizedTag} does not match shared version ${expectedVersion}. Expected ${expectedTag}.`
      );
    }
  }

  return {
    provided: true,
    ok: failures.length === 0,
    releaseTag: normalizedTag,
    tagVersion,
    expectedTag,
    failures,
  };
}

export function runVersionCheck(options = {}) {
  const entries = collectVersionEntries(options);
  const result = checkVersionConsistency(entries);
  const releaseTagCheck = checkReleaseTagVersion(
    options.releaseTag,
    result.expectedVersion
  );
  return {
    ...result,
    entries,
    releaseTagCheck,
  };
}

function printUsage() {
  console.log("Usage: node scripts/check-version-consistency.mjs [options]");
  console.log("Options:");
  console.log("  --root <path>                 Root directory to read repository files from");
  console.log(
    "  --root-package <path>          Root package.json path relative to root (default: package.json)"
  );
  console.log(
    "  --desktop-package <path>       desktop package.json path relative to root (default: apps/desktop/package.json)"
  );
  console.log(
    "  --workspace-patterns <a,b>     Comma-separated workspace patterns (default: apps/*,packages/*)"
  );
  console.log(
    "  --tauri-conf <path>            tauri.conf.json path relative to root (default: apps/desktop/src-tauri/tauri.conf.json)"
  );
  console.log(
    "  --cargo <path>                 Cargo.toml path relative to root (default: apps/desktop/src-tauri/Cargo.toml)"
  );
  console.log(
    "  --release-tag <tag>            Optional release tag to validate against the shared version (example: v0.1.0)"
  );
  console.log("  --help                        Show this help message");
}

function main() {
  try {
    const options = parseArgs();
    if (options.help) {
      printUsage();
      process.exit(0);
      return;
    }

    const { expectedVersion, mismatches, entries, allMatch, releaseTagCheck } =
      runVersionCheck(options);

    if (allMatch && releaseTagCheck.ok) {
      console.log(
        `[versions] All version fields match: ${expectedVersion} (${entries.length} entries)`
      );
      if (releaseTagCheck.provided) {
        console.log(
          `[versions] Release tag matches shared version: ${releaseTagCheck.releaseTag}`
        );
      }
      return;
    }

    if (!allMatch) {
      console.error("[versions] Version mismatch detected:");
      for (const mismatch of mismatches) {
        console.error(
          `  - ${mismatch.source}: version ${mismatch.version} (expected ${mismatch.expected})`
        );
      }
    }

    if (!releaseTagCheck.ok) {
      console.error("[versions] Release tag mismatch detected:");
      for (const failure of releaseTagCheck.failures) {
        console.error(`  - ${failure}`);
      }
    }

    process.exitCode = 1;
  } catch (error) {
    console.error(`[versions] ${String(error.message || error)}`);
    process.exitCode = 1;
  }
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] || "")) {
  main();
}
