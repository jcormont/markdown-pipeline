# Markdown Pipeline

This is a static site generator that uses asynchronous middleware-style callbacks instead of configuration and template files. JavaScript modules can be used to add Markdown text or files and assets to a pipeline, as well as middleware functions that transform inputs and outputs before they are written to the destination directory.

## Usage

On the command line, supply a destination directory and the initial JS module(s) to load:

```bash
markdown-pipeline <destinationDir> <module.js> [<other.js> ...]
```

Each module must export a `start` function, which gets called with the pipeline instance as its only argument. This function may add middleware transform functions to the pipeline, and initialize it by adding items. The items are then processed after all modules' `start` functions have run.

Each pipeline is initialized with a 'core' transform function that parses Markdown text and generates a single HTML output file (using the same path as the input file, but in the destination directory). Other transform functions can add steps to run both before and after the existing transform(s).

Use the `addTransform` method to add transform functions as follows:

```js
module.exports.start = function (pipeline) {
  pipeline.addTransform(async (item, next) => {
    // ... do something with the item input,
    // e.g. item.data (YAML front matter),
    // item.markdown (all lines of text as a string array)

    // run the remainder of the pipeline, before coming back here
    await next();

    // ... do something with the item output(s)
    // e.g. item.output (array of text files as {path, data}),
    // item.assets (array of file paths to copy {input, output})
  });

  // ...
};
```

To add items (markdown files, asset files, other content) to the pipeline, use the following methods:

- `addFile(fileName: string): Pipeline` — adds a Markdown file to the pipeline.
- `addAssets(...assets): Pipeline` — adds one or more asset files to the pipeline, that will be copied to the destination directory in their entirety.
- `add(item: Pipeline.Item): Pipeline` — adds an item to the pipeline that has been created using the item constructor.

Each pipeline has its own (relative) source path and destination path. To make things easier, you can 'spawn' a separate pipeline that has its own paths. The new pipeline will inherit the current set of transform functions from the current pipeline, but not functions that are added afterwards.

- `spawn(path: string, outputPath: string): Pipeline` — creates a new pipeline for the given paths, relative to the current input and output paths.

These methods may also be useful:

- `getItems(): Pipeline.Item[]` — returns a list of items that have been added.
- `getAllItems(): Pipeline.Item[]` — returns a list of all items that have been added to this pipeline instance as well as parent and sibling pipelines. Use this to generate e.g. tables of content from input/output across the entire pipeline.
- `find(path: string): Pipeline.Item` — returns the first item that has been added (across all related pipelines) with the given path name.
- `parseAsync(markdown: string[]): string` — parse given Markdown content; returns HTML text.
- `escapeHTML(s: string): string` — escape HTML entities.

Refer to typings in [`dist/Pipeline.d.ts`](./dist/Pipeline.d.ts) for more detail.

## Markdown syntax

This package uses [Marked](https://marked.js.org) to transform Markdown to HTML.

Additionally, the ability to add 'tags' to links and headings was added for more control when generating rich technical documentation. Some examples:

- `# Heading {#headingId}` — generates a `<h1>` heading with an `id="headingId"` attribute.
- `# Heading {:.fancy}` — adds a class attribute, i.e. `class="fancy"`.
- `[link](/here){:.some.style}` — generates a link with a class attribute, i.e. `class="some style"`.
- `[link](/here){:target="_blank"}` — generates a link with an additional attribute `target="blank"`
- `[link](/here){:.fancy target="blank"}` — generates a link with both `class` and `target` attributes.

## Why another static site generator?

This project is intended to be used for the [Typescene](https://typescene.dev) website, which was (and at the time of writing, still is) generated using Jekyll. This is not a great system for a technical documentation website. Large parts of the website are automatically generated from Typescript files though, so switching to an existing static site generator would only solve part of the problem. Templates include further generated content such as tables of content.

As a weekend project, I decided to build a different generator that is code-based rather than configuration-based, as a flexible 'hybrid' solution.

## Issues, suggestions, contributions

Use the 'Issues' and 'Discussions' tabs in Github to contribute, if you're using this package for your own project and find an issue or want to make a suggestion. Note that many 'enhancements' can be made simply using transformations, and the idea of the _pipeline_ itself is to keep it very simple.

---

(c) Copyright 2021 Jelmer Cormont, code licensed under an MIT license.
