---
title: Sample page & demo
template: main
sample_prop: This is part of the YAML front matter data
require:
  - dir/link.md
assets:
  - assets/test1.txt
  - input: "content/assets/test2.txt"
    output: "assets/out_test2.txt"
---

# Sample *file* {#top}

This is a sample markdown file.

The file contents will be processed by the pipeline, and the resulting HTML file will be added to the output folder.

It's easy to use YAML in the pipeline and replace <!--{{sample-tag content="tag content"}}-->. You can also insert properties using tags: <!--{{insert prop=sample_prop}}-->.

<!--{{import src="dir/partial.md" }}-->

<!--{{html-attr id=markdown class=special_title}}-->
## Markdown {#markdown}

Standard markdown syntax is supported, along with `<!--{{html-attr comment tags}}-->` that add properties to block and inline elements such as headings, lists, and <!--{{html-attr class=special_link target=_blank}}-->[links](dir/link.html) like <!--{{html-attr style="color: red"}}-->[this](#).

Picture:<br> <!--{{html-attr class=special_img style="border: 1px solid red"}}-->![Random photo](https://picsum.photos/100/100)

<!-- Note: -->(But note that you cannot *start* a paragraph in Markdown with an HTML element OR comment, because the remaining text will not be parsed as Markdown)

<!--{{html-attr class=special_block id=my-block}}-->
> Blockquotes and lists can also be styled

Here is a special list:

<!--{{html-attr class=special_list}}-->
- One
- Two

### Code {#code}

Syntax highlighting is performed by default, using the `highlight.js` package. You'll just need to add the `highlight.js` script and style sheet.

```js
function lookAtMe(a, b, c) {
  // ...
}
```
