import { parse } from "@babel/parser";

export type ScopeMode = "bindings" | "parameters" | "classes" | "functions" | "annotations";
type Range = [string, number, number];
type Ranges = Record<ScopeMode, Range[]>;
type SyntaxNode = { type: string; start: number; end: number; [key: string]: unknown };
type Scope = { start: number; end: number; root: boolean };
const cache = new Map<string, Ranges>();

function node(value: unknown): value is SyntaxNode {
  if (value === null || typeof value !== "object") return false;
  const entry = value as Partial<SyntaxNode>;
  return typeof entry.type === "string" && typeof entry.start === "number" && typeof entry.end === "number";
}

/** Binding patterns contain names on their left sides, never references in defaults or computed keys. */
function names(pattern: unknown): string[] {
  if (!node(pattern)) return [];
  if (pattern.type === "Identifier") return typeof pattern.name === "string" ? [pattern.name] : [];
  if (pattern.type === "AssignmentPattern") return names(pattern.left);
  if (pattern.type === "RestElement") return names(pattern.argument);
  if (pattern.type === "TSParameterProperty") return names(pattern.parameter);
  if (pattern.type === "ObjectProperty") return names(pattern.value);
  if (pattern.type === "ObjectPattern" && Array.isArray(pattern.properties)) return pattern.properties.flatMap(names);
  if (pattern.type === "ArrayPattern" && Array.isArray(pattern.elements)) return pattern.elements.flatMap(names);
  return [];
}

const functionNodes = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ObjectMethod",
  "ClassMethod",
  "ClassPrivateMethod",
  "TSDeclareFunction",
  "TSDeclareMethod",
]);
const typeDeclarations = new Set([
  "TSInterfaceDeclaration",
  "TSTypeAliasDeclaration",
  "TSDeclareFunction",
  "TSDeclareMethod",
]);

function parsedProgram(source: string): unknown {
  for (const jsx of [false, true]) {
    try {
      return parse(source, {
        sourceType: "unambiguous",
        plugins: jsx
          ? ["typescript", "jsx", "decorators-legacy"]
          : ["typescript", "decorators-legacy"],
        attachComment: false,
        errorRecovery: true,
        allowReturnOutsideFunction: true,
        allowAwaitOutsideFunction: true,
        allowUndeclaredExports: true,
      }).program;
    } catch {
      // A TS angle assertion and JSX require different grammars. Try both without rewriting source.
    }
  }
  return undefined;
}

function collect(source: string): Ranges {
  const result: Ranges = {
    bindings: [],
    parameters: [],
    classes: [],
    functions: [],
    annotations: [],
  };
  const root: Scope = { start: 0, end: source.length, root: true };
  const bind = (mode: ScopeMode, values: string[], scope: Scope): void => {
    for (const name of values) result[mode].push([name, scope.start, scope.end]);
  };
  const annotation = (value: unknown): void => {
    if (node(value)) result.annotations.push(["", value.start, value.end]);
  };
  const walk = (value: unknown, lexical: Scope, fn: Scope): void => {
    if (!node(value)) return;
    const own: Scope = { start: value.start, end: value.end, root: false };
    if (value.type === "TSTypeAnnotation" || value.type === "TSTypeParameterDeclaration") {
      annotation(value);
      return;
    }
    if (typeDeclarations.has(value.type)) {
      annotation(value);
      return;
    }
    if (value.type === "TSAsExpression" || value.type === "TSSatisfiesExpression" || value.type === "TSTypeAssertion") {
      annotation(value.typeAnnotation);
    }
    if (value.type === "VariableDeclaration" && Array.isArray(value.declarations)) {
      const scope = value.kind === "var" ? fn : lexical;
      if (!scope.root) {
        for (const declaration of value.declarations) {
          if (node(declaration)) bind("bindings", names(declaration.id), scope);
        }
      }
    }
    if (value.type === "ClassDeclaration" || value.type === "ClassExpression") {
      const scope = value.type === "ClassDeclaration" ? lexical : own;
      bind("classes", names(value.id), scope);
      if (!scope.root) bind("bindings", names(value.id), scope);
    }
    if (value.type === "FunctionDeclaration" || value.type === "FunctionExpression") {
      const scope = value.type === "FunctionDeclaration" ? lexical : own;
      bind("functions", names(value.id), scope);
      if (!scope.root) bind("bindings", names(value.id), scope);
    }
    if (functionNodes.has(value.type)) {
      const params = Array.isArray(value.params) ? value.params : [];
      const first = params.find(node);
      const scope = { start: first?.start ?? value.start, end: value.end, root: false };
      const bound = params.flatMap(names);
      bind("parameters", bound, scope);
      bind("bindings", bound, scope);
      // Body vars are not visible in non-simple parameter initializers.
      fn = node(value.body) ? { start: value.body.start, end: value.body.end, root: false } : own;
      lexical = fn;
    } else if (value.type === "CatchClause") {
      const scope = {
        start: node(value.param) ? value.param.start : value.start,
        end: value.end,
        root: false,
      };
      bind("parameters", names(value.param), scope);
      bind("bindings", names(value.param), scope);
    } else if (
      value.type === "BlockStatement" || value.type === "StaticBlock" || value.type === "TSModuleBlock" ||
      value.type === "ForStatement" || value.type === "ForInStatement" || value.type === "ForOfStatement" ||
      value.type === "SwitchStatement"
    ) {
      lexical = own;
      if (value.type === "StaticBlock" || value.type === "TSModuleBlock") fn = own;
    }
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) for (const entry of child) walk(entry, lexical, fn);
      else walk(child, lexical, fn);
    }
  };
  const program = parsedProgram(source);
  if (program === undefined) {
    // An unparseable source cannot contribute a verified registration.
    result.annotations.push(["", 0, source.length]);
  } else walk(program, root, root);
  return result;
}

/** Original source offsets keep runtime bindings separate from erased TypeScript syntax. */
export function syntaxRanges(source: string, mode: ScopeMode): Range[] {
  let result = cache.get(source);
  if (!result) {
    result = collect(source);
    if (cache.size >= 128) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(source, result);
  }
  return result[mode].map(([name, start, end]) => [name, start, end]);
}
