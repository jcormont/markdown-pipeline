import * as path from "path";
import { FileCache } from "./FileCache";
import { Pipeline } from "./Pipeline";

export * from "./Pipeline";

// check output path and module name(s)
const destPath = process.argv[2];
if (!destPath || !process.argv[3]) {
	console.error(
		"Usage: markdown-pipeline <output_path> <module.js> [<module.js> ...]"
	);
	process.exit(1);
}

// run async main function
(async () => {
	let files = new FileCache();
	let pipeline = new Pipeline("", "");

	try {
		// load given modules and run their `start` function
		let modules = process.argv.slice(3);
		pipeline.addModule(...modules);

		// wait for the pipeline to run
		await pipeline.run();

		// process all resulting output (text files, assets) and show warnings
		let warnings: string[] = [];
		let fileLog: string[] = [];
		let items = pipeline.getAllItems();
		let q: Array<Promise<void>> = [];
		for (let item of items) {
			if (item.data.inactive) continue;

			// add warnings
			if (Array.isArray(item.data.warnings)) {
				warnings.push(
					item.data.warnings.map(
						(s: any) => "Warning (" + item.path + "): " + s
					)
				);
			}

			// write output files
			if (item.output?.path) {
				let destFileName = path.join(destPath, item.output.path);
				if (path.relative(destPath, destFileName).startsWith("..")) {
					throw Error(
						"Output path is outside output directory: " + item.output.path
					);
				}
				fileLog.push("Item: " + item.path + " => " + destFileName);
				let text = item.output.text;
				q.push(files.writeTextFileAsync(destFileName, item.output.text));

				// check if any comment tags are still present in the HTML output
				let re = /\<\!--\{\{\s*[^\>\s]+[^\>]*\}\}--\>/g;
				let tagMatch: RegExpMatchArray | null;
				while ((tagMatch = re.exec(text))) {
					warnings.push(
						"Warning (" +
							item.path +
							"): Output contains unreplaced tag " +
							tagMatch[0]
					);
				}
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
						let copied = await files.copyFileAsync(asset.input, destFileName);
						if (copied)
							fileLog.push("Asset: " + asset.input + " => " + destFileName);
					})()
				);
			}
		}

		// run file operations and display summary
		await Promise.all(q);
		console.log(fileLog.join("\n") || "Warning: No output generated!");
		console.log(warnings.join("\n") || "Completed successfully.");
	} catch (err) {
		console.error("Markdown pipeline failed.");
		console.error(err);
		process.exit(1);
	}
})();
