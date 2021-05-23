import * as path from "path";
import { readTextFile } from "./files";
import {
  ParserOptions,
  parseMarkdownAsync,
  splitMarkdown,
  _h,
} from "./markdown";

/** Represents an asset file that should be copied as-is */
export interface PipelineAsset {
  /** The input file path */
  readonly input: string;

  /** The output file path (relative to the destination base dir) */
  readonly output: string;
}

export interface PipelineOutput {
  /** The output file path (relative to the destination base dir) */
  readonly path: string;

  /** Output file data, to be written to the file */
  readonly data?: string;
}

/** Pipeline core function, renders a markdown file to HTML */
async function transform(item: Pipeline.Item, pipeline: Pipeline) {
  if (item.markdown.length) {
    let fileName =
      item.data.output ||
      path.join(pipeline.outputPath, path.relative(pipeline.path, item.path)) +
        ".html";
    item.output.push({
      path: fileName,
      data: await pipeline.parseAsync(item.markdown),
    });
  }
}

/** Represents a pipeline that processes markdown files */
export class Pipeline {
  /** Create a new pipeline; do NOT use directly, use `spawn()` instead */
  constructor(inputPath: string, outputPath: string) {
    this.path = inputPath;
    this.outputPath = outputPath;
    this._f = transform;
  }

  /** Parses given markdown text (an array of strings, one for each line; or a single string for inline markdown) and returns corresponding HTML */
  async parseAsync(markdown: string | string[]) {
    return await parseMarkdownAsync(markdown, this.parserOptions);
  }

  /** Escape HTML (minimal) */
  escapeHTML(s: string) {
    return _h(s);
  }

  /** Adds a transform function to this pipeline (and all pipelines spawned from this pipeline afterwards); only takes effect for items added _after_ this call */
  addTransform(
    f: (
      item: Pipeline.Item,
      next: () => Promise<void>,
      pipeline: Pipeline
    ) => void | Promise<void>
  ) {
    let next = this._f;
    this._f = (item, pipeline) =>
      f(item, () => next(item, pipeline), pipeline) || Promise.resolve();
  }

  /** Path, relative to the current environment directory */
  readonly path: string;

  /** Output path, relative to the destination base directory */
  readonly outputPath: string;

  /** Parser options */
  readonly parserOptions: ParserOptions = {};

  /** Returns a list of all items that have been added to this pipeline **only** */
  getItems() {
    return this._items.slice();
  }

  /** Returns a list of all items that have been added to all related pipelines, including parent(s), siblings, and spawned pipelines */
  getAllItems(): Pipeline.Item[] {
    return this._allItems.slice();
  }

  /** Find the first item with given path (excluding `.md` extension) that has been added to all related pipelines, including parent(s), siblings, and spawned pipelines */
  find(itemPath: string): Pipeline.Item | undefined {
    for (let item of this._allItems) {
      if (item.path === itemPath) return item;
    }
  }

  /** Add one or more items to this pipeline */
  add(...items: Pipeline.Item[]) {
    this._items.push(...items);
    this._allItems.push(...items);
    this._run.push(
      ...items.map((it) => this._pre.then(() => this._f(it, this)))
    );
    return this;
  }

  /** Read a markdown file from given (relative) file name and add it to this pipeline; note that the file name specified is relative to the path of this pipeline, however the `path` property of the created item is relative to the root pipeline. */
  addFile(fileName: string) {
    let text = readTextFile(path.resolve(this.path, fileName));
    let { data, markdown, warnings } = splitMarkdown(text);
    if (warnings?.length) data.warnings = warnings;
    let item = new Pipeline.Item(
      path.join(this.path, fileName.replace(/\.md$/, "")),
      markdown,
      data
    );
    this.add(item);
    return this;
  }

  /** Read one or more markdown files from given (relative) file names and add them to this pipeline; note that the file names specified are relative to the path of this pipeline, however the `path` property of the created item is relative to the root pipeline. */
  addFiles(...fileNames: string[]) {
    for (let fileName of fileNames) this.addFile(fileName);
    return this;
  }

  /** Add an asset to this pipeline, for given (relative) file name; uses an anonymous pipeline item without markdown content */
  addAsset(asset: string | PipelineAsset) {
    return this.addAssets(asset);
  }

  /** Add one or more assets to this pipeline, for given (relative) file names; uses an anonymous pipeline item without markdown content */
  addAssets(...assets: (string | PipelineAsset)[]) {
    this.add(
      new Pipeline.Item(
        "@asset",
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
      )
    );
    return this;
  }

  /** Create a new pipeline, optionally using given paths (relative to the path of this pipeline); the spawned pipeline inherits all current transforms, and the current pipeline will wait for the completion of all items added to the spawned pipeline */
  spawn(relativePath?: string, outputPath?: string) {
    let targetPath = relativePath
      ? path.join(this.path, relativePath)
      : this.path;
    outputPath = path.join(this.outputPath, outputPath || relativePath || ".");
    let result = new Pipeline(targetPath, outputPath);
    result._f = this._f;
    result._allItems = this._allItems;
    this._run.push(this._pre.then(() => result.promise()));
    return result;
  }

  /** Start processing all items, and wait */
  async promise() {
    this._startWait();
    let len = 0;
    while (this._run.length > len) {
      len = this._run.length;
      await Promise.all(this._run);
    }
  }

  private _startWait!: () => void;
  private _pre = new Promise<void>((r) => {
    this._startWait = r;
  });

  private _f: (item: Pipeline.Item, pipeline: Pipeline) => Promise<void>;
  private _items: Pipeline.Item[] = [];
  private _allItems: Pipeline.Item[] = [];
  private _run: Array<Promise<void>> = [];
}

export namespace Pipeline {
  /** Represents an input item and its associated assets and data, if any */
  export class Item {
    constructor(
      path: string,
      markdown: string[] = [],
      data?: any,
      assets?: PipelineAsset[]
    ) {
      if (!path) throw RangeError();
      this.path = path;
      this.markdown = markdown;
      if (data) Object.assign(this.data, data);
      if (assets) this.assets.push(...assets);
    }

    /** Set to true if all output for this item should be ignored */
    inactive?: boolean;

    /** The relative source path of this item (excluding .md extension) */
    readonly path: string;

    /** Markdown source (lines) */
    readonly markdown: string[];

    /**
     * Data object associated with this item; includes YAML front matter from the markdown source file, and may contain special properties:
     * - `output`: the intended output path for this item (as a string, including file extension)
     * - `warnings`: any warnings that will be shown after the pipeline has finished (an array of strings)
     */
    data: any = {};

    /** List of assets that should be copied on disk along with this item */
    readonly assets: PipelineAsset[] = [];

    /** Output file(s) that should be written to disk, if any */
    readonly output: PipelineOutput[] = [];
  }
}
