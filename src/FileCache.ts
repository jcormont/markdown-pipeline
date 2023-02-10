import * as fs from "fs";
import * as path from "path";

/**
 * A utility class that contains methods for reading, writing, and copying files.
 */
export class FileCache {
	/**
	 * Reads text from given file asynchronously, and returns a Promise for its contents. The file contents are cached so subsequent reads return the same Promise.
	 * @param fileName The path of the source file
	 */
	async readTextFileAsync(fileName: string) {
		let abs = path.resolve(fileName);
		if (!fs.existsSync(abs)) throw Error("File does not exist: " + fileName);
		if (this._cache.has(abs)) return this._cache.get(abs)!;
		if (this._cacheP.has(abs)) return this._cacheP.get(abs)!;
		let p = new Promise<string>((resolve, reject) => {
			fs.readFile(fileName, (err, data) => {
				if (err) return reject(err);
				let text = String(data);
				this._cache.set(abs, text);
				resolve(text);
			});
		});
		this._cacheP.set(abs, p);
		return p;
	}

	/**
	 * Writes a text file with given text, possibly creating folders along the way
	 * @param fileName The path of the destination file
	 * @param text The text to write
	 */
	async writeTextFileAsync(fileName: string, text: string) {
		fileName = fileName.replace(/^\.\//, "");
		let dirName = path.dirname(fileName);
		if (!fs.existsSync(dirName)) {
			fs.mkdirSync(dirName, { recursive: true });
		}
		return new Promise<void>((resolve, reject) => {
			fs.writeFile(fileName, text, (err) => {
				if (err) reject(err);
				else resolve();
			});
		});
	}

	/**
	 * Copies a file in binary mode, possibly creating folders along the way
	 * @param file1 The path of the source file
	 * @param file2 The path of the destination file
	 */
	async copyFileAsync(file1: string, file2: string) {
		file2 = file2.replace(/^\.\//, "");
		if (!fs.existsSync(file1))
			throw Error("Asset file does not exist: " + file1);

		// check if already copied/copying
		if (this._copied.has(file2)) {
			if (this._copied.get(file2) === file1) return;
			throw Error(
				"Conflicting asset output:\n" +
					this._copied.get(file2) +
					" => " +
					file2 +
					"\n" +
					file1 +
					" => " +
					file2
			);
		}
		this._copied.set(file2, file1);

		// create directory if it does not exist yet
		let dirName = path.dirname(file2);
		if (!fs.existsSync(dirName)) {
			fs.mkdirSync(dirName, { recursive: true });
		}

		// return a promise for readFile then writeFile
		return new Promise<void>((resolve, reject) => {
			fs.readFile(file1, { encoding: "binary" }, (err, data) => {
				if (err) reject(err);
				else {
					fs.writeFile(file2, data, { encoding: "binary" }, (err) => {
						if (err) reject(err);
						else resolve();
					});
				}
			});
		});
	}

	private _cache = new Map<string, string>();
	private _cacheP = new Map<string, Promise<string>>();
	private _copied = new Map<string, string>();
}
