import { parse } from "@babel/parser";
import { isNode, type Node } from "@babel/types";

function* nodes(value: unknown): Generator<Node> {
  if (Array.isArray(value)) {
    for (const child of value) yield* nodes(child);
  } else if (isNode(value)) {
    yield value;
    const children: readonly unknown[] = Object.values(value);
    for (const child of children) yield* nodes(child);
  }
}

function compilerModule(specifier: string): boolean {
  return specifier === "ttsc" || specifier.startsWith("ttsc/") || specifier.startsWith("@ttsc/");
}

function compilerSpecifier(expression: Node): boolean {
  for (const node of nodes(expression)) {
    const part = node.type === "StringLiteral" ? node.value
      : node.type === "TemplateElement" ? node.value.cooked ?? node.value.raw : undefined;
    if (part !== undefined && compilerModule(part)) return true;
  }
  return false;
}

/** Inspect executable syntax, leaving JSDoc and diagnostic text out of the smoke gate. */
export function compilerCallLeft(source: string): boolean {
  const tree = parse(source, { sourceType: "unambiguous" });
  const aliases = new Map([["typia", "typia"]]);
  for (const node of nodes(tree)) {
    if (node.type === "ImportDeclaration") {
      if (compilerModule(node.source.value)) return true;
      if (node.source.value !== "typia") continue;
      for (const specifier of node.specifiers) {
        const imported = specifier.type === "ImportSpecifier"
          ? specifier.imported.type === "Identifier" ? specifier.imported.name : specifier.imported.value
          : "default";
        aliases.set(specifier.local.name, imported === "default" ? "typia" : `typia.${imported}`);
      }
    } else if ((node.type === "ExportAllDeclaration" || node.type === "ExportNamedDeclaration") && node.source) {
      if (compilerModule(node.source.value)) return true;
    } else if (node.type === "ImportExpression") {
      if (compilerSpecifier(node.source)) return true;
    } else if (node.type === "CallExpression" && node.callee.type === "Identifier" && node.callee.name === "require") {
      const specifier = node.arguments[0];
      if (specifier && compilerSpecifier(specifier)) return true;
    }
  }

  function reference(node: Node): string | undefined {
    if (node.type === "Identifier") return aliases.get(node.name);
    if (node.type !== "MemberExpression" && node.type !== "OptionalMemberExpression") return undefined;
    const object = reference(node.object);
    const property = !node.computed && node.property.type === "Identifier"
      ? node.property.name
      : node.computed && node.property.type === "StringLiteral" ? node.property.value : undefined;
    return object && property ? `${object}.${property}` : undefined;
  }

  for (const node of nodes(tree)) {
    const name = reference(node);
    if (name === "typia.createValidate" || name === "typia.json.schema") return true;
  }
  return false;
}
