exports.start = (pipeline) => {
	const templates = {
		main: {
			file: "templates/main.html",
			assets: [{ input: "templates/style.css", output: "style.css" }],
		},
	};

	async function useTemplate(item) {
		// try to match template
		let template = templates[item.data.template];
		if (template) {
			let itemHtml = item.output.text;

			// replace output with template, then replace tags
			let templateText = await pipeline.readTextFileAsync(template.file);
			item.output = { ...item.output, text: templateText };
			await item.replaceOutputTagsAsync({
				"template-content": () => itemHtml,
			});

			// add assets for this template as well
			pipeline.addAssets(...template.assets);
		}
	}

	async function sampleTag(item) {
		await item.replaceSourceTagsAsync({
			"sample-tag"(attr) {
				// return 'content' attribute in italics
				let content = attr.content;
				return "*" + content + "*";
			},
		});
	}

	// add transform functions
	pipeline.addSourceTransform(sampleTag);
	pipeline.addOutputTransform(useTemplate);

	// add a pipeline item from a string rather than a file
	let virtualItem = pipeline.addSource(
		"virtual/sample",
		"This is sample _in-memory_ content",
		undefined,
		undefined,
		async () => {
			await new Promise((r) => setTimeout(r, 100));
			virtualItem.source.push(
				"that is <!--{{sample-tag content=added}}--> asynchronously"
			);
		}
	);

	// add more content from other modules
	pipeline.spawn("content", ".", async (contentPipeline) => {
		let content = await import("./content/pipeline.js");
		content.start(contentPipeline);

		let sync = await import("./content/sync/pipeline.js");
		sync.start(contentPipeline);
	});
};
