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

  /** The output file path */
  readonly output: string;
}

export interface PipelineOutput {
  /** The relative output file path (including base dir) */
  readonly path: string;

  /** Output file data, will be written to the file directly */
  readonly data?: string;
}

/** Represents a pipeline that processes markdown files */
export class Pipeline {
  /** Create a new pipeline; do NOT use directly, use `spawn()` instead */
  constructor(inputPath: string, outputPath: string) {
    this.path = inputPath;
    this.outputPath = outputPath;
    this._f = async (item) => {
      // this is the core of the pipeline: render a markdown file to HTML
      if (item.markdown.length) {
        let fileName =
          path.join(outputPath, path.relative(this.path, item.path)) + ".html";
        item.output.push({
          path: fileName,
          data: await this.parseAsync(item.markdown),
        });
      }
    };
  }

  /** Parses given markdown text (an array of strings, one for each line) and returns corresponding HTML */
  async parseAsync(markdown: string[]) {
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
    this._f = (item) => f(item, () => next(item), this) || Promise.resolve();
  }

  /** Path, relative to the current environment directory */
  readonly path: string;

  /** Output path, relative to the current environment directory */
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

  /** Add an item to this pipeline; starts running its transformation asynchronously */
  add(item: Pipeline.Item) {
    this._items.push(item);
    this._allItems.push(item);
    this._run.push(this._pre.then(() => this._f(item)));
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

  private _f: (item: Pipeline.Item) => Promise<void>;
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

    /** Data object associated with this item; includes YAML front matter from the markdown source file */
    data: any = {};

    /** List of assets that should be copied on disk along with this item */
    readonly assets: PipelineAsset[] = [];

    /** Output file(s) that should be written to disk, if any */
    readonly output: PipelineOutput[] = [];
  }
}
