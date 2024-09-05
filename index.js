#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import Table from "cli-table3";
import chalk from "chalk";
import yoctoSpinner from "yocto-spinner";
import { fileURLToPath } from "url";
import semver from "semver";
import { Command } from "commander";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read package.json of the tool itself
const toolPackageJson = JSON.parse(
  fs.readFileSync(path.join(__dirname, "package.json"), "utf-8")
);

const program = new Command();

program
  .name(toolPackageJson.name)
  .version(toolPackageJson.version, "-v, --version")
  .option(
    "-d, --directory <path>",
    "specify the directory to check",
    process.cwd()
  )
  .option("-a, --all", "show all packages, even those without changes")
  .parse(process.argv);

const options = program.opts();

const dir = path.resolve(options.directory);
const all = options.all;

const packageJsonPath = path.join(dir, "package.json");
const packageLockPath = path.join(dir, "package-lock.json");

if (!fs.existsSync(packageJsonPath) || !fs.existsSync(packageLockPath)) {
  console.error(
    "Both package.json and package-lock.json must exist in the specified directory."
  );
  process.exit(1);
}

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
const packageLock = JSON.parse(fs.readFileSync(packageLockPath, "utf-8"));
if (!packageLock) {
  console.error("Failed to parse package-lock.json");
  process.exit(1);
}

const getLatestVersion = (packageName, versionRange) => {
  try {
    const output = execSync(
      `npm show ${packageName}@${versionRange} version --json`,
      { timeout: 10000 }
    )
      .toString()
      .trim();
    let versions;
    try {
      versions = JSON.parse(output);
    } catch (e) {
      // If JSON parsing fails, fall back to string parsing
      versions = output
        .split("\n")
        .map((line) => line.match(/['"](.+?)['"]/)?.[1])
        .filter(Boolean);
    }

    // Ensure versions is always an array
    versions = Array.isArray(versions) ? versions : [versions];

    const validVersions = versions.filter((v) => semver.valid(v));

    if (validVersions.length === 0) {
      console.warn(`No valid versions found for ${packageName}`);
      return "Unable to determine";
    }

    return (
      semver.maxSatisfying(validVersions, versionRange) ||
      validVersions[validVersions.length - 1]
    );
  } catch (error) {
    console.warn(`Error fetching version for ${packageName}: ${error.message}`);
    return "Error fetching version";
  }
};

const getInstallableVersion = (packageName, packageJson) => {
  const versionRange =
    packageJson.dependencies?.[packageName] ||
    packageJson.devDependencies?.[packageName] ||
    packageJson.peerDependencies?.[packageName];
  if (!versionRange) {
    console.warn(`Package ${packageName} not found in package.json`);
    return "Not found in package.json";
  }
  return getLatestVersion(packageName, versionRange);
};

const getInstalledVersion = (packageName, lockDependencies) => {
  // For npm 7+
  if (
    lockDependencies.packages &&
    lockDependencies.packages[`node_modules/${packageName}`]
  ) {
    return lockDependencies.packages[`node_modules/${packageName}`].version;
  }
  // For npm 6 and earlier
  if (
    lockDependencies.dependencies &&
    lockDependencies.dependencies[packageName]
  ) {
    return lockDependencies.dependencies[packageName].version;
  }
  return "Not installed";
};

const compareVersions = async () => {
  const dependencies = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
    ...packageJson.peerDependencies,
  };

  const table = new Table({
    head: [
      chalk.blue.bold("Package Name"),
      chalk.blue.bold("Dependency Type"),
      chalk.blue.bold("Installed (npm ci)"),
      chalk.blue.bold("Installable (npm i)"),
      chalk.blue.bold("Latest Version"),
    ],
    colWidths: [50, 20, 26, 26],
  });

  const spinner = yoctoSpinner({
    text: "Comparing package versions...",
  }).start();

  for (const [packageName, versionRange] of Object.entries(dependencies)) {
    spinner.text = `Checking ${packageName}...`;
    try {
      const dependencyType = packageJson.dependencies?.[packageName]
        ? "dependencies"
        : packageJson.devDependencies?.[packageName]
        ? "devDependencies"
        : packageJson.peerDependencies?.[packageName]
        ? "peerDependencies"
        : "unknown";

      const installedVersion = getInstalledVersion(packageName, packageLock);
      const installableVersion = getInstallableVersion(
        packageName,
        packageJson
      );
      const latestVersion = getLatestVersion(packageName, "latest");

      if (
        installedVersion === "Unable to determine" ||
        installableVersion === "Unable to determine" ||
        latestVersion === "Unable to determine"
      ) {
        console.warn(
          `Unable to determine all versions for ${packageName}. Skipping.`
        );
        continue;
      }

      if (
        !semver.valid(installedVersion) ||
        !semver.valid(installableVersion) ||
        !semver.valid(latestVersion)
      ) {
        console.warn(`Invalid version detected for ${packageName}. Skipping.`);
        continue;
      }

      const hasInstalledChanged = installedVersion !== installableVersion;
      const hasLatestChanged = installedVersion !== latestVersion;
      const isMajorChange =
        semver.major(installedVersion) !== semver.major(latestVersion);

      let coloredInstalledVersion = chalk.green(installedVersion);
      let coloredInstallableVersion = chalk.green(installableVersion);
      let coloredLatestVersion = chalk.green(latestVersion);

      if (hasLatestChanged) {
        const diff = semver.diff(installedVersion, latestVersion);
        const diffAnnotation = chalk.italic.gray(` (${diff})`);
        const coloredInstallableVersionRange = chalk.italic.gray(
          ` (${versionRange})`
        );

        if (isMajorChange) {
          coloredLatestVersion = chalk.red(latestVersion);
          coloredInstalledVersion = chalk.red(installedVersion);
        } else {
          coloredLatestVersion = chalk.yellow(latestVersion);
          coloredInstalledVersion = chalk.yellow(installedVersion);
        }

        coloredInstallableVersion = `${chalk.yellow(
          installableVersion
        )}${coloredInstallableVersionRange}`;
        coloredLatestVersion += diffAnnotation;
      } else if (hasInstalledChanged) {
        const diff = semver.diff(installedVersion, installableVersion);
        const diffAnnotation = chalk.italic.gray(` (${diff})`);
        coloredInstalledVersion = chalk.yellow(installedVersion);
        coloredInstallableVersion = `${chalk.yellow(
          installableVersion
        )}${chalk.italic.gray(` (${versionRange})`)}`;
        coloredInstallableVersion += diffAnnotation;
      } else {
        coloredInstallableVersion += chalk.italic.gray(` (${versionRange})`);
      }

      if (all || hasLatestChanged || hasInstalledChanged) {
        table.push([
          packageName,
          chalk.cyan(dependencyType),
          coloredInstalledVersion,
          coloredInstallableVersion,
          coloredLatestVersion,
        ]);
      }
    } catch (error) {
      console.warn(`Error processing package ${packageName}: ${error.message}`);
      continue; // Skip to the next package
    }
  }
  if (table.length === 0) {
    table.push([
      {
        content: chalk.green(
          "No installable packages found. `npm ci` and `npm i` are the same."
        ),
        colSpan: 5,
        hAlign: "center",
      },
    ]);
  }
  spinner.success("Version comparison complete!");
  console.log(table.toString());
};

compareVersions().catch((error) => {
  console.error("An error occurred:", error);
  process.exit(1);
});
