# Markdown Pipeline

This package provides a CLI command that can be used as a static site generator. Instead of using configuration and template files, Markdown Pipeline takes a different approach with a 'pipeline' of asynchronous functions. This makes it possible to add and transform content dynamically.

Markdown Pipeline provides the following functionality:

1. Adding content from Markdown files
2. Adding content from Markdown text as a string
3. Adding other output files, such as JSON files
4. Adding asset references: binary or text files that are _copied_ to the output folder
5. Spawning nested pipelines
6. Adding transform functions to the pipeline, which are invoked (asynchronously) for all new content

Every content item starts as Markdown text (other than output files and assets), and is then transformed using a set of asynchronous functions. All content is transformed in parallel, but pipeline functions for each content item are invoked one after another, grouped into the following _stages:_

- **Source stage** — contains steps to rewrite Markdown source content
- **Resolve stage** — contains steps to resolve dependencies between files and import/insert further Markdown content if needed
- **Output stage** — contains steps to generate HTML
- **Output resolve stage** — contains steps to resolve dependencies between output files and import further HTML content

Some basic functionality (see below) is already included in an empty pipeline, but the main advantage of using Markdown Pipeline is that you can add your own transform functions as well.

## Usage

On the command line, supply a destination directory and the initial JS module(s) to load:

```bash
markdown-pipeline <destinationDir> <module.js> [<other.js> ...]
```

Each module must export a `start` function, which gets called with the (initially empty) `Pipeline` instance as its only argument. This function may add content, as well as custom transform functions.

```js
// pipeline.js
// run as: markdown-pipeline ./site pipeline.js
exports.start = (pipeline) => {
  pipeline
    .addFiles("index.md")
    .addSourceTransform((item) => {
      // ... do something with the content item, see below
    })
};
```

Refer to the `sample` directory in the Markdown Pipeline repository, which demonstrates some of the features described in this document.

## Adding content

To add items (markdown files, asset files, or other content) to the pipeline, use the following `Pipeline` methods:

- `addFiles(...fileNames: string[]): Pipeline` — adds one or more Markdown files to the pipeline, including YAML front matter (see below).
- `addAssets(...assets: Array<string | { input: string, output: string }>): Pipeline` — adds one or more asset files, that will be copied to the destination directory in their entirety.
- `addSource(id: string, markdown: string, data?: any, assets?: PipelineAsset[], init?: (item) => Promise<void>): PipelineItem` — adds markdown text to the pipeline from a string
- `addOutputFile(filePath: string, text: string, data?: any): PipelineItem` — adds a single output file, that will be written to the destination directory.

Each of these methods adds one or more `PipelineItem` instances to the pipeline, which are processed _independently_ and asynchronously using the pipeline's transform functions.

Note that path/id parameters are relative to the current pipeline, but the `path` property on resulting `PipelineItem` instances (see below) are relative to the original pipeline.

### Markdown syntax

This package uses [Marked](https://marked.js.org) to transform Markdown to HTML, and [highlight.js](https://highlightjs.org) to add syntax highlighting.

Additionally, heading IDs may be specified using `{#...}` at the end of the heading line. For example:

```md
## This is a heading {#this-heading}

This allows for cross-referencing using [links](#this-heading).
```

### YAML front matter

'Front matter' at the start of a Markdown file is parsed as YAML, and properties are added to the `data` property of the `PipelineItem` instance. Some of these are handled by the pipeline itself.

- `require` — a (relative) file name or list of file names that will be added to the pipeline immediately
- `assets` — a list of (relative) file names or objects with input/output properties that are added as assets for this pipeline item
- `output` — the (relative) output path, including extension (e.g. `other/file.html`)
- `inactive` — if true, stops the pipeline for this item: no HTML output will be generated, and assets will not be copied
- `partial` — if true, stops the pipeline for this item before the 'output' stage; but referenced assets will still be copied
- `warnings` — a list of warnings (strings) that will be shown after the pipeline has finished

Any other properties can be used by pipeline transform functions, or inserted using the built-in `insert` and `html-insert` tags (see below).

To include YAML front matter in a Markdown file or string, start your text with three dashes `---`. Another line with three dashes separates the YAML content from the rest of the markdown file.

```text
---
description: This is front matter
require:
  - some_other_file.md
  - sub-dir/index.md
assets:
  - assets/my_asset.jpg
  - input: "content/full/path/file.jpg"
    output: "assets/file.jpg"
---

# Markdown

This is the rest of the markdown file...
```

## Spawning pipelines

Each pipeline has its own (relative) source path and destination path. For the pipeline that's passed to `start()`, these are both blank. To make adding content easier, you can 'spawn' separate pipelines for sub folders. New pipelines will inherit the current set of transform functions from the current pipeline, but _not_ functions that are added afterwards.

- `spawn(path?: string, outputPath?: string, init?: (pipeline) => void | Promise<void>): Pipeline` — creates a new pipeline for the given paths, relative to the current input and output paths. The input and output paths are used when loading source and asset files, and determining their destination path.

The `init` function is run _before_ any transform function is invoked for any of the pipeline's content. This allows content to be added asynchronously before the 'source' stage starts for any item, if necessary (e.g. to enable cross-referencing).

```js
exports.start = (pipeline) => {
  // add content/index.md in the context of a new pipeline:
  pipeline
    .spawn("content", ".")
    .addFile("index.md");
};
```

Furthermore, `Pipeline` instances expose the following methods to work with pipeline content:

- `waitAsync(): Promise<void>` — returns a Promise that is fulfilled when all content in this pipeline and spawned pipelines has been processed (and rejected if an error occurs).
- `getItems(): PipelineItem[]` — returns a list of items that have been added to this pipeline.
- `getAllItems(): PipelineItem[]` — returns a list of all items that have been added to the _original_ pipeline and ALL of its spawned pipelines.
- `find(path: string): PipelineItem?` — finds a pipeline item with given path, from the result of `getAllItems()`.

## Other pipeline methods

The following `Pipeline` utility methods operate independently of the pipeline content:

- `setParserOptions(options)` — sets `marked` parser options for generating HTML from markdown (see `marked` package for a list of options).
- `readTextFileAsync(fileName: string): Promise<string>` — loads the content of given text file asynchronously; the file name is relative to the input path of the pipeline. Files are cached so the same file is never loaded from disk more than once.
- `parseAsync(markdown: string[]): Promise<string>` — parse given Markdown content; returns HTML text.
- `escapeHtml(s: string): string` — escape HTML entities.
- `unescapeHtml(s: string): string` — parse HTML entities.

Refer to typings in [`dist/Pipeline.d.ts`](./dist/Pipeline.d.ts) for more detail.

## Transform stage 1 — Source

After a content item has been added to a pipeline (and its `init` function has completed, if any), the pipeline invokes all functions from the 'source' stage one by one.

To add a source stage transform function, use the pipeline's `addSourceTransform()` method. The transform function receives a single `PipelineItem` instance as its only parameter.

```js
exports.start = (pipeline) => {
  pipeline.addSourceTransform(async (item) => {
    item.source // => string[] -- markdown text (lines)
    item.path // => string -- input path of this item
    item.data // => any -- YAML front matter and other data properties
    item.pipeline // => Pipeline -- (spawned) pipeline containing this item
    item.assets // => Array<{ input, output }> -- linked assets
    // item.output => undefined during source stage

    await item.replaceSourceTagsAsync({
      tagName(attr) {
        return "replacement";
      }
    })
  });
};
```

During this stage, markdown text can be rewritten using the `source` property.

### Comment tags

To make it easier to process placeholders in the Markdown source text, Markdown Pipeline supports the use of 'comment tags': HTML-like tags that are wrapped inside of an HTML comment.

```md
Example: this is content with a <!--{{tag foo="bar"}}--> placeholder.
```

These tags can be _replaced_ using the `replaceSourceTagsAsync` method:

- `replaceSourceTagsAsync(callbacks)` — finds tags in the source text and replaces them with the return value of a matching callback function, passing in all attributes as strings. Callback functions may return a string (synchronous) or a Promise (asynchronous); this method awaits callbacks one by one.

For example, with the following input markdown text:

```md
The quick <!--{{color n="1"}}--> fox jumps over the <!--{{color n="2"}}--> dog.
```

The following pipeline function replaces each tags with a different color name.

```js
pipeline.addTransform(async (item, next) => {
  const colors = ["brown", "yellow"];
  await item.replaceSourceTagsAsync({
    color: (attrs) => {
      let idx = +attrs.n - 1;
      return colors[idx] || "???";
    }
  });
  await next();
});
```

## Transform stage 2 — Resolve

In this stage, Markdown source text is still being rewritten, but this time with the intention of cross-referencing content items.

To add a resolve stage transform function, use the pipeline's `addResolveTransform()` method.

```js
exports.start = (pipeline) => {
  pipeline.addResolveTransform(async (item) => {
    // ... same as source stage
  });
};
```

The first transform function in the resolve stage is added by Markdown Pipeline itself. This replaces the following comment tags:

- `<!--{{import src="..."}}-->` — import markdown text from a file (with given path, relative to the current content item). The markdown text passes through source and resolve stages _before_ being inserted.
- `<!--{{insert prop="..." default="..."}}>` — insert markdown text from a data property (YAML front matter), or optionally insert given default text if the property is undefined or a blank string.

The following example contains tags that are replaced during the resolve stage.

```md
Insert a data property: <!--{{insert prop="foo"}}>.

Insert a Markdown file:
<!--{{import src="some_file.md"}}-->
```

## Transform stage 3 — Output

In this stage, HTML output is available and can be rewritten if needed. This is a good time to wrap output inside of an HTML template, for example.

To add an output stage transform function, use the pipeline's `addOutputTransform()` method.

```js
exports.start = (pipeline) => {
  pipeline.addOutputTransform(async (item) => {
    // item.source => original source, do not use anymore
    item.path // => string -- input path of this item
    item.data // => any -- YAML front matter and other data properties
    item.pipeline // => Pipeline -- (spawned) pipeline containing this item
    item.assets // => Array<{ input, output }> -- linked assets
    item.output // => { path, text } -- generated HTML output

    // ... change the output
    item.output = {
      path: item.output.path,
      text: "New text"
    }

    // ... or replace tags
    await item.replaceOutputTagsAsync({
      tagName(attr) {
        return "replacement";
      }
    })
  });
};
```

You can replace comment tags (see above) in the HTML output using the `replaceOutputTags()` method:

- `replaceOutputTagsAsync(callbacks)` — finds tags in the output text (HTML) and replaces them with the return value of a matching callback function, passing in all attributes as strings. Callback functions may return a string (synchronous) or a Promise (asynchronous); this method awaits callbacks one by one.

## Transform stage 4 — Output resolve

In this stage, HTML output is still being rewritten, but this time with the intention of cross-referencing content items.

To add an output-resolve stage transform function, use the pipeline's `addOutputResolveTransform()` method.

```js
exports.start = (pipeline) => {
  pipeline.addOutputResolveTransform(async (item) => {
    // ... same as source stage
  });
};
```

The first transform function in the resolve stage is added by Markdown Pipeline itself. This replaces the following comment tags:

- `<!--{{html-import src="..."}}-->` — import HTML text from a file (with given path, relative to the current file). The HTML does _not_ pass through the pipeline and tags are not replaced.
- `<!--{{html-insert prop="..." default="..." raw}}>` — insert text from a data property (YAML front matter), or optionally insert given default text if the property is undefined or a blank string. If the 'raw' attribute is included, the text is _not_ escaped, otherwise the value is HTML-escaped before being inserted.
- `<!--{{html-attr id="..." class="..." ...}}-->` — add attribute(s) to the _following_ HTML tag, either a block-level tag (e.g. paragraph, heading, list, table) or an inline tag (e.g. bold/italic, code, link, image, etc.).

The following example contains tags that are replaced during the output-resolve stage.

```md
Insert a data property: <!--{{html-insert prop="some_html" raw}}>.

Insert a whole file:
<!--{{html-import src="some_file.html"}}-->

Add attributes to a link: <!--{{html-attr class="special-link" target="_blank"}}-->[here](#).

<!--{{html-attr class="special-paragraph"}}>
This is a paragraph with a special CSS class name.
```

## Synchronizing transforms

Often, it makes sense for pipeline stages to be delayed, while waiting for other content to be added or transformed. Because all transform functions are asynchronous, you can simply use an `await` statement (or return a Promise) in a new transform function to synchronize across different content items or pipelines.

You can also use the `waitAsync()` methods on both `Pipeline` and `PipelineItem` to wait for (all) items to be processed.

```js
exports.start = (pipeline) => {
  // create a pipeline with some content
  let p2 = pipeline.spawn().addFiles(/* ... */);

  // create a pipeline with some other content async
  let loading;
  let p3 = pipeline.spawn("", "", (p3) => {
    loading = (async () => {
      let source = await getSourceData();
      p3.addSource(source);
    })();
  });

  // make p2's resolve stage wait until p3 has been loaded
  p2.addResolveTransform(async (item) => {
    await loading;
    // ... can be sure here that p3's item exists
  });

  // make p3's output stage wait until p2 is complete
  p3.addOutputTransform(async (item) => {
    await p2.waitAsync()
    await item.replaceOutputTagsAsync({
      someTag() {
        // ... can be sure here that p2's output exists
      }
    })
  });
}
```

## Why another static site generator?

Markdown Pipeline was purpose-built for static sites that include _other_ generated content as well, such as documentation that is generated from source files. By driving the generation from a JavaScript (or TypeScript) module, it becomes much easier to include further steps into a single build process.

## Issues, suggestions, contributions

Use the 'Issues' and 'Discussions' tabs in Github to contribute, if you're using this package for your own project and find an issue or want to make a suggestion. Note that many 'enhancements' can be made simply using transformations, and the idea of the _pipeline_ itself is to keep it simple.

---

(c) Copyright 2021-2023 Jelmer Cormont, code licensed under an MIT license.
