import * as path from "path";
import { FileCache } from "./FileCache";
import { Pipeline } from "./Pipeline";

// export classes from main module
export * from "./Pipeline";
export * from "./PipelineItem";

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
	try {
		let files = new FileCache();
		let pipeline = Pipeline.main(async () => {
			// load given modules and run their `start` function
			let modules = process.argv.slice(3);
			for (let modulePath of modules) {
				let imported = await import(path.resolve(modulePath));
				imported.start?.(pipeline);
			}
		});
		await pipeline.waitAsync();

		// process all resulting output (text files, assets) and show warnings
		let warnings: string[] = [];
		let items = pipeline.getAllItems();
		let q: Array<Promise<void>> = [];
		for (let item of items) {
			if (item.data.inactive) continue;

			// add warnings
			if (Array.isArray(item.data.warnings)) {
				warnings.push(
					...item.data.warnings.map(
						(s: any) => "Warning (" + item.path + "): " + s
					)
				);
			}

			// write output files
			if (item.output) {
				let destFileName = path.join(destPath, item.output.path);
				if (path.relative(destPath, destFileName).startsWith("..")) {
					throw Error(
						"Output path is outside output directory: " + item.output.path
					);
				}
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
				q.push(files.copyFileAsync(asset.input, destFileName));
			}
		}

		// run file operations and display summary
		if (!q.length) console.log("Warning: No output generated!");
		await Promise.all(q);
		console.log(warnings.join("\n") || "Completed successfully.");
	} catch (err) {
		console.error("Markdown pipeline failed.");
		console.error(err);
		process.exit(1);
	}
})();
