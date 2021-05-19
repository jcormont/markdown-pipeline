import * as path from "path";
import { copyFileAsync, writeTextFileAsync } from "./files";
import { Pipeline } from "./Pipeline";

export * from "./Pipeline";

// read start module and output path names
const outputPath = process.argv[2];
if (!outputPath || !process.argv[3]) {
  console.error(
    "Usage: markdown-pipeline <output_path> <module.js> [<module.js> ...]"
  );
  process.exit(1);
}

// async main function
async function start() {
  let pipeline = new Pipeline("./", outputPath);

  // load given modules and run their `start` function
  for (let argi = 3; argi < process.argv.length; argi++) {
    let start = require(path.resolve(process.argv[argi])).start;
    if (!(typeof start === "function")) {
      throw Error("Module should export function start(pipeline) { ... }");
    }
    start(pipeline);
  }

  // wait for the pipeline to run
  await pipeline.promise();

  // process all resulting output
  let items = pipeline.getAllItems();
  let q: Array<Promise<string[]>> = [];
  let nWarnings = 0;
  for (let item of items) {
    if (item.inactive) continue;

    // show related warnings
    if (Array.isArray(item.data.warnings)) {
      for (let w of item.data.warnings) {
        console.log("Warning (" + item.path + "): " + w);
        nWarnings++;
      }
    }

    // write output files
    for (let out of item.output) {
      if (out.data == undefined) continue;
      if (path.relative(outputPath, out.path).startsWith("..")) {
        throw Error("Output path is outside output directory: " + out.path);
      }
      q.push(
        (async () => {
          await writeTextFileAsync(out.path, out.data!);
          return [item.path, out.path];
        })()
      );
    }

    // copy asset files
    for (let asset of item.assets) {
      if (path.relative(outputPath, asset.output).startsWith("..")) {
        throw Error(
          "Asset output path is outside output directory: " + asset.output
        );
      }
      q.push(
        (async () => {
          await copyFileAsync(asset.input, asset.output);
          return [asset.input, asset.output];
        })()
      );
    }
  }

  // display summary
  await Promise.all(
    q.map((a) =>
      a.then((log) => {
        console.log(log.join(" => "));
      })
    )
  );
  if (nWarnings) console.log(nWarnings + " Warning(s)");
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
