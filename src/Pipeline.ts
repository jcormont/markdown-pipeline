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

let _nextAnonId = 1;
let _nextImportId = 1;

/** Type definition for a pipeline transform function */
export type PipelineTransform = (item: PipelineItem) => void | Promise<void>;

/**
 * A representation of a Markdown processing pipeline, which processes markdown files and assets using a set of transform functions.
 */
export class Pipeline {
	/** Create a main pipeline with builtin transforms, and start running asynchronously after promise from async init callback resolves */
	static main(init: (pipeline: Pipeline) => Promise<void>) {
		let pipeline = new Pipeline("", "");
		pipeline.addResolveTransform(
			pipeline._builtinResolveTransform.bind(pipeline)
		);
		pipeline.addOutputResolveTransform(
			pipeline._builtinOutputResolveTransform.bind(pipeline)
		);
		Promise.resolve(pipeline)
			.then(init)
			.then(() => pipeline._resolveStart());
		return pipeline;
	}

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

	/** Set parser options that are used when converting markdown to HTML */
	setParserOptions(options: ParserOptions) {
		this._parserOptions = options;
	}

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
		return await parseMarkdownAsync(markdown, this._parserOptions);
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
	 * Adds a source-stage transform function to this pipeline (and all pipelines spawned from this pipeline afterwards).
	 * @param transform The transform function to add
	 * @returns The pipeline itself
	 */
	addSourceTransform(transform: PipelineTransform) {
		this._sourceTransforms.push(transform);
		return this;
	}

	/**
	 * Adds a resolve-stage transform function to this pipeline (and all pipelines spawned from this pipeline afterwards).
	 * @param transform The transform function to add
	 * @returns The pipeline itself
	 */
	addResolveTransform(transform: PipelineTransform) {
		this._resolveTransforms.push(transform);
		return this;
	}

	/**
	 * Adds an output-stage transform function to this pipeline (and all pipelines spawned from this pipeline afterwards).
	 * @param transform The transform function to add
	 * @returns The pipeline itself
	 */
	addOutputTransform(transform: PipelineTransform) {
		this._outputTransforms.push(transform);
		return this;
	}

	/**
	 * Adds an output resolve-stage transform function to this pipeline (and all pipelines spawned from this pipeline afterwards).
	 * @param transform The transform function to add
	 * @returns The pipeline itself
	 */
	addOutputResolveTransform(transform: PipelineTransform) {
		this._outputResolveTransforms.push(transform);
		return this;
	}

	/**
	 * Reads one or more markdown files and adds them to this pipeline (asynchronously)
	 *
	 * Markdown files may include YAML front matter, which is used to set the `data` property of the pipeline item. The following properties are handled by the pipeline itself:
	 * - `require` -- A file name (relative to the file itself) or list of file names that will be added to the pipeline immediately
	 * - `assets` -- A list of file names (relative to the file itself) or objects with input/output properties (relative to the *root* pipeline path) that are added as assets for this pipeline item during the resolve stage
	 * - `output` -- The output file name (relative to the current pipeline output path), including extension; if not set before the output stage, the output path is based on the original item path, with HTML extension
	 * - `inactive` -- If true, no further transform functions will be run and output/assets will not be saved
	 * - `partial` -- If true, source will be transformed and assets will be copied but HTML output will not be generated
	 * - `warnings` -- A list of warnings (strings) that will be shown after the pipeline has finished
	 * @param fileNames One or more file names, relative to the pipeline path
	 * @returns The pipeline itself
	 */
	addFiles(...fileNames: string[]) {
		for (let fileName of fileNames) {
			let filePath = path.resolve(this.path, fileName);
			fileName = fileName.replace(/\.md$|\.txt$/, "");

			// if not added yet, read file and add item
			let id = path.join(this.path, fileName);
			if (this._allItems.has(id)) continue;
			this._promises.push(
				(async () => {
					let text = await this._files.readTextFileAsync(filePath);
					this.addSource(fileName, text);
				})()
			);
		}
		return this;
	}

	/**
	 * Add one or more assets to this pipeline, by themselves.
	 * @param assets List of assets to be added, either as strings (relative to the current pipeline path) or objects with input/output properties (relative to the *root* pipeline path)
	 * @returns The pipeline itself
	 */
	addAssets(...assets: Array<string | PipelineAsset>) {
		let item = new PipelineItem(
			this,
			"@asset:" + _nextAnonId++,
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
		init?: (item: PipelineItem) => void | Promise<void>
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
			if (init) await init(item!);
			await this._transform(item!);
		})();
		item = new PipelineItem(this, itemPath, markdown, data, assets, promise);
		this._items.push(item);
		this._allItems.set(item.path, item);
		this._promises.push(promise);

		// handle 'require' property as a list of markdown files
		if (data.require) {
			let files: string[] = Array.isArray(data.require)
				? data.require
				: [data.require];
			this.addFiles(...files.map((s) => this._relPath(item, s)));
		}
		return item;
	}

	/**
	 * Add an output (text) file from a string. The resulting item is NOT processed by any pipeline functions.
	 * @param filePath The output file name or path, relative to the current output path
	 * @param text The text to write to the output file
	 * @returns The pipeline itself
	 */
	addOutputFile(filePath: string, text: string, data = {}) {
		let item = new PipelineItem(
			this,
			"@file:" + _nextAnonId++,
			undefined,
			data
		);
		item.output = { path: path.join(this.outputPath, filePath), text };
		this._items.push(item);
		this._allItems.set(item.path, item);
		return item;
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
		init?: (pipeline: Pipeline) => void | Promise<void>
	) {
		let targetPath = relativePath
			? path.join(this.path, relativePath)
			: this.path;
		outputPath = path.join(this.outputPath, outputPath || relativePath || ".");

		// create new pipeline with given paths
		let result = new Pipeline(targetPath, outputPath);
		Object.assign(result._parserOptions, this._parserOptions);
		result._sourceTransforms.push(...this._sourceTransforms);
		result._resolveTransforms.push(...this._resolveTransforms);
		result._outputTransforms.push(...this._outputTransforms);
		result._outputResolveTransforms.push(...this._outputResolveTransforms);
		result._allItems = this._allItems;
		result._files = this._files;

		// wait for pipeline to complete
		this._promises.push(
			(async () => {
				await this._startP;
				if (init) await init(result);
				result._resolveStart();
				await result.waitAsync();
			})()
		);
		return result;
	}

	/** Returns a promise that is fulfilled when all pipeline items have been processed. The promise is rejected if an error occurs. */
	async waitAsync() {
		await this._startP;
		let len = 0;
		while (this._promises.length > len) {
			len = this._promises.length;
			await Promise.all(this._promises);
		}
	}

	/** Runs all transform functions for given item */
	private async _transform(item: PipelineItem) {
		let skip = false;
		const parseAsync = async () => {
			if (item.data.partial) skip = true;
			else if (item.source.length) {
				item.output = {
					text: await this.parseAsync(item.source),
					path: item.data.output
						? path.join(this.outputPath, item.data.output)
						: path.join(this.outputPath, path.relative(this.path, item.path)) +
						  ".html",
				};
			}
		};

		let funcs: PipelineTransform[] = [
			...this._sourceTransforms,
			...this._resolveTransforms,
			parseAsync,
			...this._outputTransforms,
			...this._outputResolveTransforms,
		];
		for (let f of funcs) {
			if (item.data.inactive || skip) return;
			await f(item);
		}
	}

	/** Helper function that is added as a resolve transform function, handles import and insert tags, and adds assets from data */
	private async _builtinResolveTransform(item: PipelineItem) {
		let pipeline = item.pipeline;
		await item.replaceSourceTagsAsync({
			import: async (attr) => {
				let srcPath = pipeline._relPath(item, attr.src);
				let text = await pipeline.readTextFileAsync(srcPath);
				let imported = pipeline.addSource(
					path.join(pipeline.path, srcPath + "__import#" + _nextImportId++),
					text,
					{ partial: true }
				);
				await imported.waitAsync();
				return imported.source.join("\n");
			},
			insert: (attr) => item.data[attr.prop] || attr.default || "",
		});

		// handle 'assets' property as a list of asset filenames
		if (Array.isArray(item.data.assets)) {
			for (let asset of item.data.assets) {
				if (typeof asset === "string") {
					let relAsset = pipeline._relPath(item, asset);
					let input = path.join(pipeline.path, relAsset);
					let output = path.join(pipeline.outputPath, relAsset);
					item.assets.push({ input, output });
				} else if (asset.input && asset.output) {
					item.assets.push(asset);
				} else {
					throw Error("Invalid asset referenced from " + item.path);
				}
			}
		}
	}

	/** Helper function that is added as an output resolve transform function, handles html-import and html-insert tags */
	private async _builtinOutputResolveTransform(item: PipelineItem) {
		let pipeline = item.pipeline;
		if (item.output && item.output.text) {
			await new Promise((r) => setTimeout(r, 1000));
			await item.replaceOutputTagsAsync({
				"html-import": (attr) => {
					return pipeline.readTextFileAsync(pipeline._relPath(item, attr.src));
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

	/** Given a pipeline item and a path relative to the item path, returns a path relative to the current pipeline path */
	private _relPath(item: PipelineItem, src: string) {
		let relDir = path.relative(this.path, path.dirname(item.path));
		return path.join(relDir, src);
	}

	private _resolveStart!: () => void;
	private _startP = new Promise<void>((r) => {
		this._resolveStart = r;
	});

	private _sourceTransforms: Array<PipelineTransform> = [];
	private _resolveTransforms: Array<PipelineTransform> = [];
	private _outputTransforms: Array<PipelineTransform> = [];
	private _outputResolveTransforms: Array<PipelineTransform> = [];

	private _promises: Array<Promise<void>> = [];
	private _items: PipelineItem[] = [];
	private _allItems = new Map<string, PipelineItem>();
	private _files: FileCache;

	private _parserOptions: ParserOptions = {};
}
