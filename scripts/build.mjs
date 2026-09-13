import { cp, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";

const root = process.cwd();
const sourceDirectory = path.join(root, "src");
const outputDirectory = path.join(root, "dist");

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
await cp(
  path.join(sourceDirectory, "manifest.json"),
  path.join(outputDirectory, "manifest.json"),
);

const entries = [
  ["background/index.ts", "background.js"],
  ["content/index.ts", "content.js"],
  ["popup/index.ts", "popup.js"],
];

for (const [source, output] of entries) {
  const directoryEntries = await readdir(
    path.dirname(path.join(sourceDirectory, source)),
  ).catch(() => []);
  if (!directoryEntries.includes(path.basename(source))) {
    continue;
  }

  await build({
    entryPoints: [path.join(sourceDirectory, source)],
    bundle: true,
    outfile: path.join(outputDirectory, output),
    format: "iife",
    platform: "browser",
    target: "chrome120",
    sourcemap: true,
  });
}

for (const [source, output] of [
  ["popup/index.html", "popup.html"],
  ["popup/styles.css", "popup.css"],
]) {
  await cp(
    path.join(sourceDirectory, source),
    path.join(outputDirectory, output),
  ).catch(() => undefined);
}
