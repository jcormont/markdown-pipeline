import { replaceCommentTagsAsync } from "./markdown";
import { Pipeline } from "./Pipeline";

/**
 * An object that represents an asset file, which gets copied to the output as-is
 */
export interface PipelineAsset {
	/** The input file path, relative to the root pipeline input path */
	readonly input: string;

	/** The output file path, relative to the destination base path */
	readonly output: string;
}

/**
 * An object that represents an output file, typically HTML generated from a markdown source file
 */
export interface PipelineOutput {
	/** The output file path, relative to the destination base path */
	readonly path: string;

	/** Output text to be written to the file */
	readonly text: string;
}

/**
 * Representation of an input item, its output and associated assets, if any
 */
export class PipelineItem {
	/** Constructor for a pipeline item, used by pipeline `add` methods */
	constructor(
		pipeline: Pipeline,
		path: string,
		markdown: string[] = [],
		data?: any,
		assets?: PipelineAsset[],
		promise?: Promise<void>
	) {
		if (!path) throw RangeError();
		this.pipeline = pipeline;
		this.path = path;
		this.source = markdown;
		this._transformPromise = promise;
		if (data) Object.assign(this.data, data);
		if (assets) this.assets.push(...assets);
	}

	/** The pipeline that this item has been added to */
	readonly pipeline: Pipeline;

	/** The source path of this item (excluding .md extension), relative to the _root_ pipeline */
	readonly path: string;

	/** Markdown source text (lines) */
	readonly source: string[];

	/** The data associated with this item, as an object. This includes YAML front matter from the markdown source file, if any. */
	data: any = {};

	/** File name and text content of the output file that should be written to disk, if any */
	output?: PipelineOutput;

	/** A list of assets that should be copied on disk along with this item */
	readonly assets: PipelineAsset[] = [];

	/**
	 * Returns a promise that is resolved when all transform functions have finished for this pipeline item.
	 */
	async waitAsync() {
		await this._transformPromise;
		return this;
	}

	/**
	 * Replaces special tags inside comments (e.g. `<!--{{tag attr="value"}}-->`) in the source text. Tags are replaced with return values of the corresponding callback function (based on the tag name, which is matched with properties of the object parameter).
	 * @note This method must be awaited, and must be called from inside of a source/resolve transform function for it to have any effect on the generated output.
	 * @param callbacks An object specifying callback functions. Callbacks are called with all attributes of the tag (e.g. `{ attr: "value" }` in the example above; all values are HTML-unescaped strings). Callbacks must return a string or a Promise that resolves to a string.
	 */
	async replaceSourceTagsAsync(callbacks: {
		[tagName: string]: (props: any) => string | Promise<string>;
	}) {
		for (let i = 0; i < this.source.length; i++) {
			let lines = (
				await replaceCommentTagsAsync(this.source[i]!, callbacks)
			).split("\n");
			if (lines.length === 1) {
				this.source[i] = lines[0]!;
			} else {
				this.source.splice(i, 1, ...lines);
				i += lines.length - 1;
			}
		}
	}

	/**
	 * Replaces special tags inside comments (e.g. `<!--{{tag attr="value"}}-->`) in the output text. Tags are replaced with return values of the corresponding callback function (based on the tag name, which is matched with properties of the object parameter).
	 * @note This method must be awaited, and must be called from inside of an output (or output resolve) transform function for it to have any effect on the generated output.
	 * @param callbacks An object specifying callback functions. Callbacks are called with all attributes of the tag (e.g. `{ attr: "value" }` in the example above; all values are HTML-unescaped strings). Callbacks must return a string or a Promise that resolves to a string.
	 */
	async replaceOutputTagsAsync(callbacks: {
		[tagName: string]: (props: any) => string | Promise<string>;
	}) {
		if (this.output) {
			this.output = {
				path: this.output.path,
				text: await replaceCommentTagsAsync(this.output.text, callbacks),
			};
		}
	}

	private _transformPromise?: Promise<void>;
}
