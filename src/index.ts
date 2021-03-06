import * as path from "path";
import { copyFileAsync, writeTextFileAsync } from "./files";
import { Pipeline } from "./Pipeline";

export * from "./Pipeline";

// read start module and output path names
const destPath = process.argv[2];
if (!destPath || !process.argv[3]) {
  console.error(
    "Usage: markdown-pipeline <output_path> <module.js> [<module.js> ...]"
  );
  process.exit(1);
}

// async main function
async function start() {
  let pipeline = new Pipeline("", "");

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
      let destFileName = path.join(destPath, out.path);
      if (path.relative(destPath, destFileName).startsWith("..")) {
        throw Error("Output path is outside output directory: " + out.path);
      }
      q.push(
        (async () => {
          await writeTextFileAsync(destFileName, out.data!);
          return [item.path, destFileName];
        })()
      );
    }

    // copy asset files
    for (let asset of item.assets) {
      let destFileName = path.join(destPath, asset.output);
      if (path.relative(destPath, destFileName).startsWith("..")) {
        throw Error(
          "Asset output path is outside output directory: " + asset.output
        );
      }
      q.push(
        (async () => {
          await copyFileAsync(asset.input, destFileName);
          return [asset.input, destFileName];
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
