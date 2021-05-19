import * as fs from "fs";
import * as path from "path";

/** Read a text file from start to finish as a string */
export function readTextFile(fileName: string) {
  // (this used to be an async function but that meant file reads would
  // finish out of order, and add items to the pipeline randomly; there
  // isn't an enormous speed up anyway so let's not do async here)
  return String(fs.readFileSync(fileName));
}

/** Write a text file to contain given text */
export async function writeTextFileAsync(fileName: string, text: string) {
  fileName = fileName.replace(/^\.\//, "");
  if (!/^\w/.test(fileName))
    throw Error("Invalid output file name: " + fileName);
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

/** Copy a file in binary mode */
export async function copyFileAsync(file1: string, file2: string) {
  let dirName = path.dirname(file2);
  if (!fs.existsSync(dirName)) {
    fs.mkdirSync(dirName, { recursive: true });
  }
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
