// Runs the server's TypeScript from the console (node --import ./scripts/ts-loader.mjs file.ts):
// extensionless and "@/" imports resolve like Next, and each .ts file is
// transpiled with TypeScript (parameter properties need more than type stripping).
import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = pathToFileURL(`${process.cwd()}/`).href;

registerHooks({
  resolve(specifier, context, next) {
    const spec = specifier.startsWith("@/") ? root + specifier.slice(2) : specifier;
    if ((spec.startsWith(".") || spec.startsWith("file:") || spec.startsWith("/")) && !/\.([cm]?[jt]sx?|json)$/.test(spec)) {
      const base = new URL(spec, context.parentURL);
      for (const ext of [".ts", ".tsx", "/index.ts"]) {
        const url = new URL(base.href + ext);
        if (existsSync(fileURLToPath(url))) return next(url.href, context);
      }
    }
    return next(spec, context);
  },
  load(url, context, next) {
    // Next imports JSON without an attribute; Node needs one.
    if (url.startsWith("file:") && url.endsWith(".json") && !url.includes("/node_modules/")) {
      return { format: "json", source: readFileSync(fileURLToPath(url), "utf8"), shortCircuit: true };
    }
    if (!/\.tsx?$/.test(url) || url.includes("/node_modules/")) return next(url, context);
    const { outputText } = ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
      fileName: fileURLToPath(url),
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023, jsx: ts.JsxEmit.ReactJSX, sourceMap: false, inlineSourceMap: true },
    });
    return { format: "module", source: outputText, shortCircuit: true };
  },
});
