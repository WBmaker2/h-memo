import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const SEMVER_PATTERN = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const REPOSITORY_PATTERN = /^[^/\s]+\/[^/\s]+$/;

function requireOption(options, name, displayName = name) {
  const value = options[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`--${displayName} requires a value.`);
  }
  return value.trim();
}

export function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    version: null,
    releaseTag: null,
    repository: null,
    assetDir: null,
    manifestAssetName: null,
    output: null,
    notes: null,
    help: false,
  };
  const optionNames = new Map([
    ["--version", "version"],
    ["--release-tag", "releaseTag"],
    ["--repository", "repository"],
    ["--asset-dir", "assetDir"],
    ["--asset-name", "manifestAssetName"],
    ["--output", "output"],
    ["--notes", "notes"],
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    const optionName = optionNames.get(arg);
    if (optionName) {
      if (index + 1 >= argv.length) {
        throw new Error(`${arg} requires a value.`);
      }
      options[optionName] = argv[index + 1];
      index += 1;
      continue;
    }

    let matchedInlineOption = false;
    for (const [name, key] of optionNames) {
      if (arg.startsWith(`${name}=`)) {
        options[key] = arg.slice(name.length + 1);
        matchedInlineOption = true;
        break;
      }
    }
    if (!matchedInlineOption) {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function normalizeVersion(version) {
  const normalized = requireOption({ version }, "version");
  if (!SEMVER_PATTERN.test(normalized)) {
    throw new Error(`Invalid updater version: ${normalized}`);
  }
  return normalized.replace(/^v/, "");
}

function normalizeRepository(repository) {
  const normalized = requireOption({ repository }, "repository");
  if (!REPOSITORY_PATTERN.test(normalized)) {
    throw new Error(`Invalid GitHub repository: ${normalized}`);
  }
  return normalized;
}

function normalizeReleaseTag(releaseTag) {
  const normalized = requireOption({ releaseTag }, "releaseTag", "release-tag");
  if (!/^v?[0-9A-Za-z][0-9A-Za-z.-]*$/.test(normalized)) {
    throw new Error(`Invalid release tag: ${normalized}`);
  }
  return normalized;
}

function normalizeSignature(signature) {
  if (typeof signature !== "string" || signature.trim() === "") {
    throw new Error("Updater signature must contain the generated .sig file content.");
  }
  return signature.trim();
}

export function createUpdaterManifest({
  version,
  releaseTag,
  repository,
  assetName,
  signature,
  notes = null,
  publishedAt = new Date().toISOString(),
}) {
  const normalizedVersion = normalizeVersion(version);
  const normalizedTag = normalizeReleaseTag(releaseTag);
  const normalizedRepository = normalizeRepository(repository);
  const normalizedAssetName = requireOption({ assetName }, "assetName", "asset-name");
  const normalizedSignature = normalizeSignature(signature);

  if (normalizedAssetName.includes("/") || normalizedAssetName.includes("\\")) {
    throw new Error(`Invalid updater asset name: ${normalizedAssetName}`);
  }

  const parsedPublishedAt = new Date(publishedAt);
  if (Number.isNaN(parsedPublishedAt.getTime())) {
    throw new Error(`Invalid updater publication date: ${publishedAt}`);
  }

  const encodedTag = encodeURIComponent(normalizedTag);
  const encodedAssetName = encodeURIComponent(normalizedAssetName);
  return {
    version: normalizedVersion,
    notes: typeof notes === "string" && notes.trim() ? notes.trim() : `H Memo ${normalizedVersion} 업데이트`,
    pub_date: parsedPublishedAt.toISOString(),
    platforms: {
      "windows-x86_64": {
        url: `https://github.com/${normalizedRepository}/releases/download/${encodedTag}/${encodedAssetName}`,
        signature: normalizedSignature,
      },
    },
  };
}

function findSingleMsi(assetDir) {
  const normalizedAssetDir = path.resolve(assetDir);
  if (!existsSync(normalizedAssetDir)) {
    throw new Error(`Updater asset directory not found: ${normalizedAssetDir}`);
  }

  const msiFiles = readdirSync(normalizedAssetDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".msi"))
    .map((entry) => entry.name);
  if (msiFiles.length !== 1) {
    throw new Error(
      `Expected exactly one MSI updater asset in ${normalizedAssetDir}, found ${msiFiles.length}.`
    );
  }

  return {
    assetDir: normalizedAssetDir,
    assetName: msiFiles[0],
  };
}

export function createUpdaterManifestFromDirectory({
  version,
  releaseTag,
  repository,
  assetDir,
  manifestAssetName = null,
  notes = null,
  publishedAt,
}) {
  const { assetDir: normalizedAssetDir, assetName: localAssetName } = findSingleMsi(assetDir);
  const signaturePath = path.join(normalizedAssetDir, `${localAssetName}.sig`);
  if (!existsSync(signaturePath)) {
    throw new Error(`Updater signature not found: ${signaturePath}`);
  }

  return createUpdaterManifest({
    version,
    releaseTag,
    repository,
    assetName: manifestAssetName ?? localAssetName,
    signature: readFileSync(signaturePath, "utf8"),
    notes,
    publishedAt,
  });
}

function printUsage() {
  console.log(
    "Usage: node scripts/create-updater-manifest.mjs --version <version> " +
      "--release-tag <tag> --repository <owner/name> --asset-dir <dir> --output <file> " +
      "[--asset-name <published-name>] [--notes <text>]"
  );
}

export function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv);
    if (options.help) {
      printUsage();
      return null;
    }

    const version = requireOption(options, "version");
    const releaseTag = requireOption(options, "releaseTag", "release-tag");
    const repository = requireOption(options, "repository");
    const assetDir = requireOption(options, "assetDir");
    const output = requireOption(options, "output");
    const manifest = createUpdaterManifestFromDirectory({
      version,
      releaseTag,
      repository,
      assetDir,
      manifestAssetName: options.manifestAssetName,
      notes: options.notes,
    });

    writeFileSync(path.resolve(output), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    console.log(`[create:updater-manifest] wrote ${path.resolve(output)}`);
    return manifest;
  } catch (error) {
    console.error(`[create:updater-manifest] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return null;
  }
}
