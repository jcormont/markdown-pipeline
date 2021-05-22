import * as yaml from "js-yaml";
import * as marked from "marked";
import * as hljs from "highlight.js";

export type ParserOptions = marked.MarkedOptions;

const _heading_regex = /^(#+)\s+(.*)$/;
const _link_regex = /\[([^\]]+)\]\(([^\)]+)\)(?:(\{[^\}]*\}))?/g;

/** Return HTML property string for 'tag' substring taken from markdown (fairly liberal implementation of the same in kramdown, i.e. quick and dirty) */
function _propsForTag(tag: string) {
  let classNames: string[] = [];
  let props = "";
  tag.replace(
    /(?:\#([-\w]+))|(?:\.([-\w]+))|(\w+=\"[^\"\}]*\")/g,
    (_s, id, className, propSpec) => {
      if (id) props += ` id="${id.replace(/\\(.)/g, "$1")}"`;
      if (className) classNames.push(className.replace(/\\(.)/g, "$1"));
      if (propSpec) props += " " + propSpec.replace(/\\(.)/g, "$1");
      return "";
    }
  );

  if (classNames.length) props += ` class="${classNames.join(" ")}"`;
  return props;
}

/** HTML-escape */
export function _h(s: string) {
  return s
    .replace(/\&/g, "&amp;")
    .replace(/\"/g, "&quot;")
    .replace(/\</g, "&lt;")
    .replace(/\>/g, "&gt;");
}

/** Split given text (lines array) into data from YAML front matter, and markdown itself */
export function splitMarkdown(text: string) {
  let markdown = text.split(/\r\n|\n\r|\r|\n/);
  let warnings: string[] = [];
  let data: any = {};
  if (/^\-{3,}/.test(markdown[0])) {
    // read YAML front matter into 'data' object
    let idx = 1;
    let yamlStr = "";
    while (idx < markdown.length) {
      if (/^\-{3,}/.test(markdown[idx])) break;
      yamlStr += markdown[idx++] + "\n";
    }
    data = yaml.load(yamlStr, {
      onWarning(e) {
        warnings.push(String(e));
      },
    });
    markdown.splice(0, idx + 1);
  }
  return { markdown, data, warnings };
}

/** Parse given markdown text (lines), returns HTML text */
export async function parseMarkdownAsync(
  text: string | string[],
  options: marked.MarkedOptions
) {
  // enable syntax highlighting by default
  if (!options.highlight) {
    options.highlight = (code, lang) => {
      return hljs.highlight(code, { language: lang }).value;
    };
  }

  /** Helper function that transforms headings with tags to HTML */
  const parseHeadings = (s: string) =>
    s.replace(_heading_regex, (_s, prefix: string, text: string) => {
      // found a heading, parse the tag at the end, if any
      let level = prefix.length;
      let props = "";
      text = text.replace(/\s*\{[^\}]+\}\s*$/, (tag) => {
        props = _propsForTag(tag);
        return "";
      });
      text = marked.parseInline(text, options);
      return `<h${level}${props}>${text}</h${level}>`;
    });

  /** Helper function that transforms links with tags to HTML */
  const parseLinks = (s: string) =>
    s.replace(_link_regex, (_s, text: string, href: string, tag: string) => {
      // found a link, parse it, including the tag at the end
      let props = "";
      if (tag) props = _propsForTag(tag);
      text = marked.parseInline(text, options);
      return `<a href="${_h(href)}"${props}>${text}</a>`;
    });

  // use `marked` with given options, and transform headings and links
  return !Array.isArray(text)
    ? marked.parseInline(parseLinks(parseHeadings(text as string)), options)
    : new Promise<string>((resolve, reject) =>
        marked.parse(
          (text as string[])
            .map((s) => parseLinks(parseHeadings(s)))
            .join("\n"),
          options,
          (err, result) => {
            if (err) reject(err);
            else resolve(result);
          }
        )
      );
}
