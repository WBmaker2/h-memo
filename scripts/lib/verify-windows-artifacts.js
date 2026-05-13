import { readdirSync, existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const DEFAULT_BUNDLE_DIR = path.join(
  "apps",
  "desktop",
  "src-tauri",
  "target",
  "release",
  "bundle"
);

export function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    bundleDir: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--bundle-dir") {
      if (i + 1 >= argv.length) {
        throw new Error("--bundle-dir requires a value.");
      }
      options.bundleDir = argv[i + 1];
      i += 1;
      continue;
    }

    if (arg.startsWith("--bundle-dir=")) {
      options.bundleDir = arg.slice("--bundle-dir=".length);
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
  }

  return options;
}

function collectMatchingFiles(dirPath, extensions) {
  if (!existsSync(dirPath)) {
    return [];
  }

  const normalizedExtensions = new Set(extensions.map((ext) => ext.toLowerCase()));
  return readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .filter((entry) =>
      normalizedExtensions.has(path.extname(entry.name).toLowerCase())
    )
    .map((entry) => path.resolve(path.join(dirPath, entry.name)));
}

export function verifyWindowsArtifacts({ bundleDir = DEFAULT_BUNDLE_DIR } = {}) {
  const normalizedBundleDir = path.resolve(bundleDir);
  const nsisDir = path.join(normalizedBundleDir, "nsis");
  const msiDir = path.join(normalizedBundleDir, "msi");

  const nsisFiles = collectMatchingFiles(nsisDir, [".exe"]);
  const msiFiles = collectMatchingFiles(msiDir, [".msi"]);

  if (nsisFiles.length === 0 && msiFiles.length === 0) {
    throw new Error(
      `No Windows installer artifacts found under ${normalizedBundleDir}. ` +
        "Expected at least one .exe in nsis/ or one .msi in msi/."
    );
  }

  return {
    bundleDir: normalizedBundleDir,
    nsisDir: path.resolve(nsisDir),
    msiDir: path.resolve(msiDir),
    nsisFiles,
    msiFiles,
  };
}

function printArtifactSummary(bundleDir) {
  const result = verifyWindowsArtifacts({ bundleDir });
  const nsisFound = result.nsisFiles.length;
  const msiFound = result.msiFiles.length;

  console.log(`[verify:windows-artifacts] bundleDir=${result.bundleDir}`);
  console.log(`[verify:windows-artifacts] nsisDir=${result.nsisDir}`);
  console.log(`[verify:windows-artifacts] msiDir=${result.msiDir}`);
  console.log(`[verify:windows-artifacts] nsis artifact count=${nsisFound}`);
  console.log(`[verify:windows-artifacts] msi artifact count=${msiFound}`);

  if (nsisFound) {
    console.log(`[verify:windows-artifacts] nsis artifacts:`);
    for (const file of result.nsisFiles) {
      console.log(`  - ${file}`);
    }
  }

  if (msiFound) {
    console.log(`[verify:windows-artifacts] msi artifacts:`);
    for (const file of result.msiFiles) {
      console.log(`  - ${file}`);
    }
  }

  return result;
}

function printUsage() {
  console.log(
    "Usage: node scripts/verify-windows-artifacts.mjs [--bundle-dir <path>]"
  );
  console.log("  --bundle-dir  Optional path (default: apps/desktop/src-tauri/target/release/bundle)");
}

export function main() {
  try {
    const { help, bundleDir } = parseArgs();
    if (help) {
      printUsage();
      process.exit(0);
    }
    printArtifactSummary(bundleDir ?? DEFAULT_BUNDLE_DIR);
  } catch (err) {
    console.error(`[verify:windows-artifacts] ${String(err.message || err)}`);
    process.exitCode = 1;
  }
}
