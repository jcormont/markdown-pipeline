# Markdown Pipeline

This package can be used as a static site generator. When invoked from the command line, it takes Markdown files and asset files (e.g. CSS and images) as inputs, and saves the resulting HTML files along with copies of the assets to an output directory.

Instead of using configuration and template files, Markdown Pipeline takes a different approach with middleware-style asynchronous functions for adding content to a _pipeline_ and processing both Markdown input and HTML output using code.

## Usage

On the command line, supply a destination directory and the initial JS module(s) to load:

```bash
markdown-pipeline <destinationDir> <module.js> [<other.js> ...]
```

Each module must export a `start` function, which gets called with the pipeline instance as its only argument. This function may add middleware-style transform functions to the pipeline, as well as source files and assets.

Each pipeline is initialized with a 'core' transform function that parses Markdown text and generates a single HTML output file (using the same path as the input file, but in the destination directory). Other transform functions can add code to run both before and after the existing transform(s).

Use the `addTransform` method to add transform functions as follows:

```js
exports.start = (pipeline) => {
  pipeline.addTransform(async (item, next) => {
    // ... do something with the item input,
    // e.g. item.data (YAML front matter), or
    // item.source (all lines of markdown text as a string array)

    // run the remainder of the pipeline, before coming back here
    await next();

    // ... do something with the item output,
    // e.g. item.output (object with {path, text}), or
    // item.assets (array of file paths to copy {input, output})
  });

  // ...
};
```

Transform functions are useful for adding generated content or wrapping the result in an HTML template. However, it's important to note that these functions do not supply input (markdown) files themselves.

To add items (markdown files, asset files, other content) to the pipeline, use the following methods _after_ adding transform functions:

- `addFile(...fileNames: string[]): Pipeline` — adds one or more Markdown files to the pipeline.
- `addSource(id: string, markdown: string | string[], data?: any, assets?: PipelineAsset[]): PipelineItem` — adds in-memory markdown text to the pipeline
- `addAsset(...assets: { input: string, output: string }[]): Pipeline` — adds one or more asset files to the pipeline, that will be copied to the destination directory in their entirety.

```js
exports.start = (pipeline) => {
  // ... add transform functions first if needed, see above

  // add (main) content:
  pipeline.addFile("index.md");
};
```

Each pipeline has its own (relative) source path and destination path. To make things easier, you can 'spawn' a separate pipeline that has its own paths. The new pipeline will inherit the current set of transform functions from the current pipeline, but not functions that are added afterwards.

- `spawn(path: string, outputPath: string): Pipeline` — creates a new pipeline for the given paths, relative to the current input and output paths. The input and output paths are used when loading source and asset files, and determining their destination path.

```js
exports.start = (pipeline) => {
  // add content/index.md in the context of a new pipeline:
  pipeline
    .spawn("content", ".")
    .addFile("index.md");
};
```

To run another JavaScript module (or multiple), passing the current pipeline to the exported `start(pipeline)` function, use the `addModule()` method. Note that this can also be used on spawned pipelines.

- `addModule(...fileNames: string[]): Pipeline` — add one or more modules and run their `start` function.

```js
exports.start = (pipeline) => {
  // add pipeline transforms from another module:
  pipeline.addModule("transforms.js");

  // ... now add content
}
```

Furthermore, these pipeline methods may be useful within transform functions:

- `getItems(): PipelineItem[]` — returns a list of items that have been added.
- `getAllItems(): PipelineItem[]` — returns a list of all items that have been added to all related pipeline instances. Use this to generate e.g. tables of content from input/output across the entire pipeline.
- `find(path: string): PipelineItem?` — finds an existing pipeline item with given path, from all related pipeline instances.
- `parseAsync(markdown: string[]): Promise<string>` — parse given Markdown content; returns HTML text.
- `readTextFileAsync(fileName: string): Promise<string>` — loads the content of given text file asynchronously; the file name is relative to the path of the pipeline.
- `escapeHtml(s: string): string` — escape HTML entities.
- `unescapeHtml(s: string): string` — parse HTML entities.

Refer to typings in [`dist/Pipeline.d.ts`](./dist/Pipeline.d.ts) for more detail.

You can wait for the pipeline to finish for a particular item by calling the `waitAsync()` method on the pipeline item _itself_.

To replace _comment tags_ in source or output content (e.g. `this is a <!--{{tag with="attributes"}}-->`), use one of these methods on the pipeline item:

- `replaceSourceTagsAsync(callbacks)` — finds tags in the source text and replaces them with the return value of a matching callback function
- `replaceOutputTagsAsync(callbacks)` — finds tags in the output text (HTML) and replaces them with the return value of a matching callback function

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

Several tags are replaced automatically: refer to the _Markdown syntax and tags_ section below.

Note that tag replacement using another syntax is also possible, of course, with a pipeline transform function that doesn't use `replaceSourceTagsAsync` but manipulates source or output strings themselves.

Refer to typings in [`dist/PipelineItem.d.ts`](./dist/PipelineItem.d.ts) for more detail. Also, a `sample` directory is included in the repository to demonstrate some of the above features.

## Markdown syntax and tags

This package uses [Marked](https://marked.js.org) to transform Markdown to HTML, and [highlight.js](https://highlightjs.org) to add syntax highlighting. 'Comment tags' are used for some additional functionality.

Two types of comment tags are replaced immediately _before_ parsing the markdown source text:

- `<!--{{import src="..."}}-->` — import markdown text from a file (with given path, relative to the current file). The markdown text passes through the pipeline before being inserted.
- `<!--{{insert prop="..." default="..."}}>` — insert markdown text from a data property (YAML front matter), optionally insert given default text if the property is undefined or a blank string.

A number of comment tags are replaced in the generated HTML, at the very end of the pipeline, _after_ all transform functions:

- `<!--{{html-import src="..."}}-->` — import HTML text from a file (with given path, relative to the current file). The HTML does not pass through the pipeline and further tags are not replaced.
- `<!--{{html-insert prop="..." default="..." raw}}>` — insert text from a data property (YAML front matter), optionally insert given default text if the property is undefined or a blank string. If the 'raw' attribute is included, the text is _not_ escaped, otherwise the value is HTML-escaped before being inserted.
- `<!--{{html-attr id="..." class="..." ...}}-->` — add (any) given attribute(s) to the _following_ HTML tag, either a block-level tag or inline (paragraph, heading, list, table, or bold/italic, code, link, image, etc.).

```md
Insert a data property: <!--{{insert prop="some_md"}}-->, or HTML: <!--{{html-insert prop="some_html" raw}}>.

Add attributes to a link: <!--{{html-attr class="special-link" target="_blank"}}-->[here](#).

<!--{{html-attr class="special-paragraph"}}>
This is a paragraph with a special CSS class name.
```

## YAML front matter

'Front matter' at the start of a Markdown file is parsed as YAML, and properties are added to the `data` property of the pipeline item. Some of these are handled by the pipeline itself.

- `require` — A file name or list of file names that will be added to the pipeline immediately
- `assets` — A list of file names or objects with input/output properties that are added as assets for this pipeline item
- `output` — The (relative) output path, including extension
- `inactive` — If true, no HTML output will be generated, and assets will not be copied
- `partial` — If true, HTML output will still be generated, but not saved (output path is cleared)
- `warnings` — A list of warnings (strings) that will be shown after the pipeline has finished

Any other properties can be used by pipeline transform functions, or inserted using the built-in `insert` and `html-insert` tags.

To include YAML front matter, start the text file with three dashes `---`. Another line with three dashes separates the YAML content from the rest of the markdown file.

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

## Why another static site generator?

Markdown Pipeline was purpose-built for static sites that include _other_ generated content as well, such as documentation that is generated from source files. By driving the generation from a JavaScript (or TypeScript) module, it becomes much easier to include further steps into a single build process.

## Issues, suggestions, contributions

Use the 'Issues' and 'Discussions' tabs in Github to contribute, if you're using this package for your own project and find an issue or want to make a suggestion. Note that many 'enhancements' can be made simply using transformations, and the idea of the _pipeline_ itself is to keep it simple.

---

(c) Copyright 2021-2023 Jelmer Cormont, code licensed under an MIT license.
