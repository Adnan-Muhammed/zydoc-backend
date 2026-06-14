import fs from "fs";
import path from "path";

const rootDir = path.join(process.cwd(), "src");

function printTree(dir, prefix = "") {
    const files = fs.readdirSync(dir);

    files.forEach((file, index) => {
        const fullPath = path.join(dir, file);
        const isLast = index === files.length - 1;
        const connector = isLast ? "└── " : "├── ";

        console.log(prefix + connector + file);

        if (fs.statSync(fullPath).isDirectory()) {
            const newPrefix = prefix + (isLast ? "    " : "│   ");
            printTree(fullPath, newPrefix);
        }
    });
}

console.log("📁 src");
printTree(rootDir);















