import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { builtinModules } from "node:module";
import test from "node:test";
import ts from "typescript";
/** Current extensions need no host-vendored packages, including after hot updates. */
test("current extensions require no retired vendored runtime dependencies", () => {
	const builtin = new Set(builtinModules);
	for (const file of readdirSync("resources/extensions").filter((name) => name.endsWith(".ts"))) {
		const source = ts.createSourceFile(file, readFileSync(join("resources/extensions", file), "utf8"), ts.ScriptTarget.Latest, true);
		function check(node) {
			let spec;
			if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) spec = node.moduleSpecifier;
			if (ts.isExportDeclaration(node) && !node.isTypeOnly) spec = node.moduleSpecifier;
			if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(source) === "require")) spec = node.arguments[0];
			if (spec && ts.isStringLiteral(spec)) assert.ok(spec.text.startsWith(".") || spec.text.startsWith("node:") || builtin.has(spec.text) || spec.text.startsWith("@earendil-works/") || spec.text === "typebox", file + ": unsupported runtime import " + spec.text);
			ts.forEachChild(node, check);
		}
		check(source);
	}
});
