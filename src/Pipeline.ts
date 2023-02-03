import * as path from "path";
import {
	ParserOptions,
	parseMarkdownAsync,
	splitMarkdown,
	parseHtmlAttrTags as replaceHtmlAttrTags,
} from "./markdown";
import { FileCache } from "./FileCache";
import { PipelineAsset, PipelineItem } from "./PipelineItem";
import { decode, encode } from "html-entities";

let _nextAssetId = 1;
let _nextImportId = 1;

/** Type definition for a pipeline transform function */
export type PipelineTransform = (
	item: PipelineItem,
	next: () => Promise<void>
) => void | Promise<void>;

/**
 * A representation of a Markdown processing pipeline, which processes markdown files and assets using a set of transform functions.
 */
export class Pipeline {
	/**
	 * Creates a new pipeline.
	 * @note Do NOT use this constructor directly, use `spawn()` instead.
	 */
	constructor(inputPath: string, outputPath: string) {
		this.path = inputPath;
		this.outputPath = outputPath;
		this._files = new FileCache();
	}

	/** The input path, relative to the current environment directory */
	readonly path: string;

	/** The output path, relative to the destination base directory */
	readonly outputPath: string;

	/** Parser options that are used when converting markdown to HTML */
	readonly parserOptions: ParserOptions = {};

	/**
	 * Returns a list of all items that have been added to this pipeline **only**.
	 */
	getItems() {
		return this._items.slice();
	}

	/**
	 * Returns a list of **all** items that have been added to all related pipelines, including parent(s), siblings, and spawned pipelines.
	 */
	getAllItems(): PipelineItem[] {
		return Array.from(this._allItems.values());
	}

	/**
	 * Finds an existing pipeline item with given path, from any of the related pipelines (including parents, siblings, and spawned pipelines)
	 * @note The item path for markdown files does NOT include the `.md` or `.txt` extension.
	 * @param itemPath The item path to look for, relative to the _root_ pipeline
	 * @returns A single pipeline item
	 */
	find(itemPath: string): PipelineItem | undefined {
		return this._allItems.get(itemPath);
	}

	/**
	 * Parses given markdown text and returns a promise for the corresponding HTML.
	 * @param markdown The markdown text; either as an array of strings, one for each line; or as a single string for inline markdown
	 * @returns A promise for the HTML output string
	 */
	async parseAsync(markdown: string | string[]) {
		return await parseMarkdownAsync(markdown, this.parserOptions);
	}

	/** A helper method that returns HTML-escaped text. */
	escapeHtml(s: string) {
		return encode(s || "");
	}

	/** A helper method that returns HTML-parsed text. */
	unescapeHtml(s: string) {
		return decode(s || "");
	}

	/**
	 * A helper method that loads the content of given text file asynchronously.
	 * @param fileName The path of the file to read, relative to the current pipeline path
	 */
	async readTextFileAsync(fileName: string) {
		return this._files.readTextFileAsync(path.resolve(this.path, fileName));
	}

	/**
	 * Loads given JS module(s) and runs their exported 'start' function. The current pipeline is supplied as the function's only argument.
	 * @param fileNames File names of one or more JavaScript source files to run, relative to the current pipeline path
	 * @returns The pipeline itself
	 */
	addModule(...fileNames: string[]) {
		for (let fileName of fileNames) {
			try {
				let start = require(path.resolve(this.path, fileName)).start;
				if (!(typeof start === "function")) {
					throw Error("Module should export function start(pipeline) { ... }");
				}
				start(this);
			} catch (err) {
				throw Error(
					"In pipeline module " + path.join(this.path, fileName) + ":\n" + err
				);
			}
		}
		return this;
	}

	/**
	 * Adds transform function(s) to this pipeline (and all pipelines spawned from this pipeline afterwards).
	 * @note The transform function only takes effect for items added _after_ this call.
	 * @param transforms One or more transform functions
	 * @returns The pipeline itself
	 */
	addTransform(...transforms: Array<PipelineTransform>) {
		this._transforms.push(...transforms);
		return this;
	}

	/**
	 * Reads one or more markdown files and adds them to this pipeline (synchronously)
	 *
	 * Markdown files may include YAML front matter, which is used to set the `data` property of the pipeline item. The following properties are handled by the pipeline itself:
	 * - `require` -- A file name (relative to the file itself) or list of file names that will be added to the pipeline immediately
	 * - `assets` -- A list of file names (relative to the file itself) or objects with input/output properties (relative to the *root* pipeline path) that are added as assets for this pipeline item
	 * - `output` -- The output file name (relative to the current pipeline output path), including extension; if not set, the output path is based on the original item path, with HTML extension
	 * - `inactive` -- If true, no HTML output will be generated, and assets will not be copied
	 * - `partial` -- If true, HTML output will still be generated, but not saved (output path is cleared)
	 * - `warnings` -- A list of warnings (strings) that will be shown after the pipeline has finished
	 * @param fileNames One or more file names, relative to the pipeline path
	 * @returns The pipeline itself
	 */
	addFile(...fileNames: string[]) {
		for (let fileName of fileNames) {
			let filePath = path.resolve(this.path, fileName);
			fileName = fileName.replace(/\.md$|\.txt$/, "");

			// if not added yet, read file and add item
			let id = path.join(this.path, fileName);
			if (this._allItems.has(id)) continue;
			let text = this._files.readTextFile(filePath);
			this.addSource(fileName, text);
		}
		return this;
	}

	/**
	 * Adds given markdown text to the pipeline, from memory instead of a file.
	 *
	 * Markdown text may include YAML front matter; refer to {@link addFile()} for a list of special properties.
	 * @param id The 'path' of the item that is added to the pipeline, relative to the current pipeline input path; does not need to exist as a file
	 * @param text Markdown text, may include YAML front matter
	 * @param itemData Pipeline item data, overrides properties from front matter
	 * @param assets List of assets that should be included in the output on behalf of this item
	 * @param init An (async) function that is awaited _before_ pipeline transforms are run on this pipeline item
	 * @returns The newly added pipeline item
	 */
	addSource(
		id: string,
		text: string,
		itemData: any = {},
		assets: PipelineAsset[] = [],
		init?: () => void | Promise<void>
	) {
		let itemPath = path.join(this.path, id);
		if (this._allItems.has(itemPath)) {
			throw Error("Item already exists in pipeline: " + itemPath);
		}

		// split markdown and YAML front matter
		// note that most data properties are handled elsewhere
		let { data, markdown, warnings } = splitMarkdown(text);
		if (warnings?.length) data.warnings = warnings;
		data = { ...itemData, ...data };

		// add pipeline item
		let item: PipelineItem;
		let promise = (async () => {
			await this._startP;
			if (init) await init();
			await this._transform(item!);
		})();
		item = new PipelineItem(this, itemPath, markdown, data, assets, promise);
		this._items.push(item);
		this._allItems.set(item.path, item);
		this._run.push(promise);

		// handle 'require' property as a list of markdown files
		if (data.require) {
			let files: string[] = Array.isArray(data.require)
				? data.require
				: [data.require];
			this.addFile(...files.map((s) => this._relPath(item, s)));
		}
		return item;
	}

	/**
	 * Add one or more assets to this pipeline, by themselves.
	 * @param assets List of assets to be added, either as strings (relative to the current pipeline path) or objects with input/output properties (relative to the *root* pipeline path)
	 * @returns The pipeline itself
	 */
	addAsset(...assets: (string | PipelineAsset)[]) {
		let item = new PipelineItem(
			this,
			"@asset:" + _nextAssetId++,
			undefined,
			undefined,
			assets.map((a) =>
				typeof a === "string"
					? {
							input: path.join(this.path, a),
							output: path.join(this.outputPath, a),
					  }
					: a
			)
		);
		this._items.push(item);
		this._allItems.set(item.path, item);
		return this;
	}

	/**
	 * Creates a new pipeline, optionally using new path(s). The spawned pipeline inherits all current transforms, but not those that are added *after* calling this method.
	 * @param relativePath Input path, relative to the current pipeline path; if omitted, the new path will be the same as the current path
	 * @param outputPath Output path, relative to the current output path; if omitted, `relativePath` is used, or if both are omitted, the new output path will be the same as the current output path
	 * @param init An (async) function that is awaited _before_ pipeline transforms are run on this pipeline
	 * @returns The newly created pipeline
	 */
	spawn(
		relativePath?: string,
		outputPath?: string,
		init?: () => void | Promise<void>
	) {
		let targetPath = relativePath
			? path.join(this.path, relativePath)
			: this.path;
		outputPath = path.join(this.outputPath, outputPath || relativePath || ".");

		// create new pipeline with given paths
		let result = new Pipeline(targetPath, outputPath);
		Object.assign(result.parserOptions, this.parserOptions);
		result._transforms.push(...this._transforms);
		result._allItems = this._allItems;
		result._files = this._files;

		// add function to wait for pipeline to complete
		this._run.push(
			(async () => {
				await this._startP;
				if (init) await init();
				await result.run();
			})()
		);
		return result;
	}

	/** Starts processing all items, and returns a promise that is resolved when done */
	async run() {
		if (this._running) return;
		this._running = true;
		this._resolveStart();
		let len = 0;
		while (this._run.length > len) {
			len = this._run.length;
			await Promise.all(this._run);
		}
	}

	/** Runs all transform functions for given item */
	private async _transform(item: PipelineItem) {
		let funcs: PipelineTransform[] = [...this._transforms];
		let next = () =>
			funcs.length
				? funcs.shift()!.call(undefined, item, next)
				: this._handleItemAsync(item);
		await next();

		// after transforms, handle HTML replacement tags
		if (item.output && item.output.text) {
			await item.replaceOutputTagsAsync({
				"html-import": (attr) => {
					return this.readTextFileAsync(this._relPath(item, attr.src));
				},
				"html-insert": (attr) =>
					attr["raw"]
						? item.data[attr.prop] || attr.default || ""
						: this.escapeHtml(item.data[attr.prop] || attr.default || ""),
			});
			item.output = {
				...item.output,
				text: replaceHtmlAttrTags(item.output.text),
			};
		}
	}

	/** Parses markdown text for given pipeline item and prepares HTML output (core pipeline function) */
	private async _handleItemAsync(item: PipelineItem) {
		if (item.data.inactive) return;

		// handle 'assets' property as a list of asset filenames
		if (Array.isArray(item.data.assets)) {
			for (let asset of item.data.assets) {
				if (typeof asset === "string") {
					let relAsset = this._relPath(item, asset);
					let input = path.join(this.path, relAsset);
					let output = path.join(this.outputPath, relAsset);
					item.assets.push({ input, output });
				} else if (asset.input && asset.output) {
					item.assets.push(asset);
				} else {
					throw Error("Invalid asset referenced from " + item.path);
				}
			}
		}

		// handle import and insert tags
		await item.replaceSourceTagsAsync({
			import: async (attr) => {
				let srcPath = this._relPath(item, attr.src);
				let text = await this.readTextFileAsync(srcPath);
				let imported = this.addSource(
					path.join(this.path, srcPath + "__import#" + _nextImportId++),
					text,
					{ partial: true }
				);
				await imported.waitAsync();
				return imported.source.join("\n");
			},
			insert: (attr) => item.data[attr.prop] || attr.default || "",
		});

		// parse markdown and set output object
		if (item.source.length) {
			let fileName = item.data.partial
				? undefined
				: item.data.output
				? path.join(this.outputPath, item.data.output)
				: path.join(this.outputPath, path.relative(this.path, item.path)) +
				  ".html";

			let text = await this.parseAsync(item.source);
			item.output = { path: fileName, text };
		}
	}

	/** Given a pipeline item and a path relative to the item path, returns a path relative to the current pipeline path */
	private _relPath(item: PipelineItem, src: string) {
		let relDir = path.relative(this.path, path.dirname(item.path));
		return path.join(relDir, src);
	}

	private _running?: boolean;
	private _resolveStart!: () => void;
	private _startP = new Promise<void>((r) => {
		this._resolveStart = r;
	});

	private _transforms: Array<PipelineTransform> = [];
	private _items: PipelineItem[] = [];
	private _allItems = new Map<string, PipelineItem>();
	private _run: Array<Promise<void>> = [];
	private _files: FileCache;
}
