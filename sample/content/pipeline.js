exports.start = (pipeline) => {
	// add two files, the rest is referenced from here:
	pipeline.addFile("index.md", "untitled.md");
};
