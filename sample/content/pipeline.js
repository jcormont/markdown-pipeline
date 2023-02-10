exports.start = (pipeline) => {
	// add two files, the rest is referenced from here:
	pipeline.addFiles("index.md", "untitled.md");

	// add a JSON file, which doesn't go through the pipeline at all
	pipeline.addOutputFile(
		"data/test.json",
		JSON.stringify(["This is a test", { a: 1, b: 2, c: 3 }], undefined, "  ")
	);
};
