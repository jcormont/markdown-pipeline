exports.start = (pipeline) => {
	// create a pipeline with some content
	let p2 = pipeline.spawn().addFiles("sync/p2.md");

	// create a pipeline with some other content async
	let loading;
	let p3 = pipeline.spawn("", "", (p3) => {
		loading = (async () => {
			await new Promise((r) => setTimeout(r, 100));
			let text = await p3.readTextFileAsync("sync/p3.md");
			p3.addSource("sync/p3", text);
			console.log("P3 added");
		})();
	});

	// make p2's resolve stage wait until p3 has been loaded
	p2.addResolveTransform(() => loading).addResolveTransform(async (item) => {
		await item.replaceSourceTagsAsync({
			p3data() {
				// can be sure that p3 items have been added
				console.log("P3", p3.getItems());
				return p3.getItems()[0]?.data.someData || "NOT FOUND!";
			},
		});
	});

	// make p3's output stage wait until p2 is complete
	p3.addOutputTransform(async (item) => {
		await p2.waitAsync();
		await item.replaceOutputTagsAsync({
			p2output() {
				// can be sure that p2 output exists
				return p2.getItems()[0]?.output?.text;
			},
		});
	});
};
