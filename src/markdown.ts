import * as yaml from "js-yaml";
import { marked } from "marked";
import hljs from "highlight.js";
import { decode, encode } from "html-entities";

// avoid dependency on @types/marked here, by copying options interface:

/**
 * An interface for all parser options, same as `marked.MarkedOptions`
 */
export interface ParserOptions {
	baseUrl?: string;
	breaks?: boolean;
	gfm?: boolean;
	headerIds?: boolean;
	headerPrefix?: string;
	langPrefix?: string;
	mangle?: boolean;
	pedantic?: boolean;
	sanitize?: boolean;
	silent?: boolean;
	smartypants?: boolean;
	xhtml?: boolean;
	highlight?(
		code: string,
		lang: string,
		callback?: (error: any | undefined, code?: string) => void
	): string | void;
}

/**
 * A helper function that splits given text (lines array) into an object containing YAML front matter properties, and markdown itself (lines array).
 * @returns An object containing `markdown` (string array), `data` (object), and `warnings` (string array) properties.
 */
export function splitMarkdown(text: string) {
	let markdown = text.split(/\r\n|\n\r|\r|\n/);
	let warnings: string[] = [];
	let data: any = {};
	if (/^\-{3,}/.test(markdown[0]!)) {
		// read YAML front matter into 'data' object
		let idx = 1;
		let yamlStr = "";
		while (idx < markdown.length) {
			if (/^\-{3,}/.test(markdown[idx]!)) break;
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

/**
 * A helper function that parses given markdown text (string or lines) asynchronously.
 * @param text The markdown input, as a string (inline markdown) or an array of strings (block level).
 * @param options Markdown parser options
 * @returns A promise for the HTML output string.
 */
export async function parseMarkdownAsync(
	text: string | string[],
	options: ParserOptions
) {
	// enable syntax highlighting by default
	if (!options.highlight) {
		options.highlight = (code, lang) => {
			if (!lang || !code) return code;
			return hljs.highlight(code, { language: lang }).value;
		};
	}

	// disable header IDs by default, since we can use comment tags
	if (options.headerIds == null) options.headerIds = false;

	// use `marked` with given options, and parse comment tags
	let result = !Array.isArray(text)
		? marked.parseInline(text, options)
		: new Promise<string>((resolve, reject) =>
				marked.parse((text as string[]).join("\n"), options, (err, result) => {
					if (err) reject(err);
					else resolve(result);
				})
		  );
	return result;
}

/**
 * A helper function that applies additional styles to HTML elements if they are preceded by a comment that contains a tag like <!--{{html-attr ...}}-->
 */
export function parseHtmlAttrTags(s: string) {
	return s.replace(
		/(\<\!--\{\{html-attr [^\>]+\}\}--\>)\s*(\<\w+)/g,
		(_s, tag: string, htmlStart: string) => {
			let props = parseCommentTagProps(tag);
			for (let prop in props) {
				htmlStart += ` ${prop}="${encode(props[prop])}"`;
			}
			return htmlStart;
		}
	);
}

/**
 * A helper function that parses a comment tag, like `<!--{{tag attr="value"}}-->`, and returns all attributes as properties of an object
 */
export function parseCommentTagProps(tag: string): [string, any] {
	if (!tag.startsWith("<!--{{") || !tag.endsWith("}}-->")) throw Error();
	tag = tag.slice(6, -5).replace(/^\s*\S+/, ""); // remove tag name

	// match all attributes within the tag using a RegExp
	let re = /([^\s\"\=]+)(?:\s*\=\s*(?:([^\s\"]+)|\"([^\"]*)\"))?/g;
	let match: RegExpMatchArray | null;
	let props: any = Object.create(null);
	while ((match = re.exec(tag))) {
		let [_s, id, token, str] = match;
		props[id!] = token ?? (str != null ? decode(str) : id);
	}
	return props;
}

/**
 * A helper function that replaces comment tags using results from given callback functions, asynchronously
 */
export async function replaceCommentTagsAsync(
	text: string,
	callbacks: {
		[tagName: string]: (props: any) => string | Promise<string>;
	}
) {
	let result = "";
	let lastIdx = 0;
	let re = /\<\!--\{\{\s*([^\>\s]+)[^\>]*\}\}--\>/g;
	let match: RegExpMatchArray | null;
	while ((match = re.exec(text))) {
		let cb = callbacks[match[1]!];
		if (cb) {
			let tag = match[0];
			let repl = await cb(parseCommentTagProps(tag));
			if (typeof repl !== "string")
				throw Error("Invalid replacement for " + tag);
			result += text.slice(lastIdx, match.index) + repl;
			lastIdx = match.index! + tag.length;
		}
	}
	return result + text.slice(lastIdx);
}
