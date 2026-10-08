import { parse } from "@babel/parser";

export type ScopeMode =
  | "bindings" | "parameters" | "classes" | "functions"
  | "annotations" | "enumValues" | "destructuring" | "objectMethods" | "containerReferences";
type Range = [string, number, number];
export type DestructuringAssignment = {
  name: string;
  at: number;
  end: number;
  evaluation: "value" | "default" | "opaque";
};
type Ranges = Record<ScopeMode, Range[]> & { assignments: DestructuringAssignment[] };
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
  const plugins = [
    "typescript",
    "decorators-legacy",
    "deferredImportEvaluation",
    "decoratorAutoAccessors",
  ] as const;
  for (const jsx of [false, true]) {
    try {
      return parse(source, {
        sourceType: "unambiguous",
        plugins: [...plugins, ...(jsx ? ["jsx" as const] : [])],
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
    enumValues: [],
    destructuring: [],
    objectMethods: [],
    containerReferences: [],
    assignments: [],
  };
  const undefinedBindings: Range[] = [];
  const assignments: SyntaxNode[] = [];
  const root: Scope = { start: 0, end: source.length, root: true };
  const bind = (mode: ScopeMode, values: string[], scope: Scope): void => {
    for (const name of values) {
      result[mode].push([name, scope.start, scope.end]);
      if (name === "undefined" && ["bindings", "parameters", "classes", "functions", "destructuring"].includes(mode)) {
        undefinedBindings.push([name, scope.start, scope.end]);
      }
    }
  };
  const annotation = (value: unknown): void => {
    if (node(value)) result.annotations.push(["", value.start, value.end]);
  };
  const containerReference = (value: unknown): void => {
    if (!node(value)) return;
    let bare = value;
    while (["TSAsExpression", "TSSatisfiesExpression", "TSNonNullExpression", "ParenthesizedExpression"].includes(bare.type) && node(bare.expression)) {
      bare = bare.expression;
    }
    if (bare.type === "Identifier") bind("containerReferences", names(bare), { start: value.start, end: value.end, root: false });
  };
  const propertyKey = (value: unknown): string | undefined => {
    if (!node(value)) return undefined;
    if (value.type === "Identifier") return names(value)[0];
    if (value.type === "StringLiteral" && typeof value.value === "string") return value.value;
    return undefined;
  };
  const assignmentValues = (pattern: unknown, value: unknown, end: number, opaqueAt: number, deferred = false): void => {
    if (!node(pattern)) return;
    if (pattern.type === "Identifier") {
      for (const name of names(pattern)) result.assignments.push({
        name,
        at: node(value) ? value.start : opaqueAt,
        end,
        evaluation: node(value) ? deferred ? "default" : "value" : "opaque",
      });
    } else if (pattern.type === "AssignmentPattern") {
      const globalUndefined = node(value) && value.type === "Identifier" && value.name === "undefined" &&
        !undefinedBindings.some(([, start, until]) => value.start >= start && value.start < until);
      const missing = value === null || globalUndefined || node(value) && value.type === "UnaryExpression" && value.operator === "void";
      const nextValue = missing ? pattern.right : value;
      assignmentValues(pattern.left, nextValue, end, opaqueAt, deferred || missing);
    } else if (pattern.type === "ObjectPattern" && Array.isArray(pattern.properties)) {
      const literal = node(value) && value.type === "ObjectExpression";
      const properties = literal && Array.isArray(value.properties) ? value.properties : [];
      for (const target of pattern.properties) {
        if (!node(target)) continue;
        let source: unknown = literal ? null : undefined;
        const key = !target.computed ? propertyKey(target.key) : undefined;
        if (key !== undefined && key !== "__proto__") {
          for (const candidate of [...properties].reverse()) {
            if (!node(candidate)) continue;
            if (candidate.type === "SpreadElement" || candidate.computed || propertyKey(candidate.key) === "__proto__") {
              source = undefined;
              break;
            }
            if (propertyKey(candidate.key) !== key) continue;
            source = candidate.type === "ObjectProperty" ? candidate.value : undefined;
            break;
          }
        } else source = undefined;
        const binding = target.type === "RestElement" ? target.argument : target.value;
        assignmentValues(binding, source, end, opaqueAt, deferred);
      }
    } else if (pattern.type === "ArrayPattern" && Array.isArray(pattern.elements)) {
      const literal = node(value) && value.type === "ArrayExpression" && Array.isArray(value.elements) &&
        !value.elements.some((entry) => node(entry) && entry.type === "SpreadElement");
      const elements = literal ? value.elements as unknown[] : [];
      pattern.elements.forEach((target, index) => {
        const element = literal ? (elements[index] ?? null) : undefined;
        assignmentValues(target, element, end, opaqueAt, deferred);
      });
    } else for (const name of names(pattern)) result.assignments.push({ name, at: opaqueAt, end, evaluation: "opaque" });
  };
  const enumValue = (value: unknown): void => {
    if (!node(value)) return;
    if (value.type === "Identifier" || value.type === "MemberExpression" || value.type === "OptionalMemberExpression") {
      result.enumValues.push(["", value.start, value.end]);
    } else if (value.type.startsWith("TS") || value.type === "ParenthesizedExpression") enumValue(value.expression);
    else if (value.type === "ConditionalExpression") {
      enumValue(value.consequent);
      enumValue(value.alternate);
    } else if (value.type === "LogicalExpression") {
      enumValue(value.left);
      enumValue(value.right);
    } else if (value.type === "ArrayExpression" && Array.isArray(value.elements)) value.elements.forEach(enumValue);
    else if (value.type === "ObjectExpression" && Array.isArray(value.properties)) {
      for (const property of value.properties) if (node(property)) enumValue(property.value ?? property.argument);
    } else if (value.type === "SequenceExpression" && Array.isArray(value.expressions)) enumValue(value.expressions.at(-1));
    else if (value.type === "AssignmentExpression") enumValue(value.right);
  };
  const walk = (value: unknown, lexical: Scope, fn: Scope): void => {
    if (!node(value)) return;
    const own: Scope = { start: value.start, end: value.end, root: false };
    if (value.type === "ObjectMethod") result.objectMethods.push(["", value.start, value.end]);
    if (value.type === "VariableDeclarator") containerReference(value.init);
    if (value.type === "AssignmentExpression") containerReference(value.right);
    if (value.type === "AssignmentExpression" && value.operator === "=" && node(value.left) &&
        (value.left.type === "ObjectPattern" || value.left.type === "ArrayPattern")) {
      assignments.push(value);
    }
    if (value.type === "ObjectProperty") containerReference(value.value);
    if (value.type === "SpreadElement") containerReference(value.argument);
    if (value.type === "ArrayExpression" && Array.isArray(value.elements)) value.elements.forEach(containerReference);
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
    if (
      (value.type === "ObjectMethod" || value.type === "ClassMethod" || value.type === "ClassPrivateMethod") &&
      node(value.key)
    ) {
      const decorators = Array.isArray(value.decorators) ? value.decorators.filter(node) : [];
      const start = decorators.at(-1)?.end ?? value.start;
      const end = value.computed ? value.key.start : value.key.end;
      // Method names/modifiers are syntax; decorators and computed keys still execute.
      if (start < end) result.annotations.push(["", start, end]);
    }
    if (value.type === "VariableDeclaration" && Array.isArray(value.declarations)) {
      const scope = value.kind === "var" ? fn : lexical;
      for (const declaration of value.declarations) {
        if (node(declaration) && names(declaration.id).includes("undefined")) undefinedBindings.push(["undefined", scope.start, scope.end]);
        if (node(declaration) && node(declaration.id) &&
            (declaration.id.type === "ObjectPattern" || declaration.id.type === "ArrayPattern")) {
          bind("destructuring", names(declaration.id), { ...scope, start: value.start });
        }
      }
      if (!scope.root) {
        for (const declaration of value.declarations) {
          if (node(declaration)) bind("bindings", names(declaration.id), scope);
        }
      }
    }
    if (["ImportSpecifier", "ImportDefaultSpecifier", "ImportNamespaceSpecifier"].includes(value.type) && names(value.local).includes("undefined")) {
      undefinedBindings.push(["undefined", lexical.start, lexical.end]);
    }
    if (value.type === "ClassDeclaration" || value.type === "ClassExpression" || value.type === "TSEnumDeclaration" || value.type === "TSModuleDeclaration") {
      const scope = value.type === "ClassExpression" ? own : lexical;
      bind("classes", names(value.id), scope);
      if (!scope.root) bind("bindings", names(value.id), scope);
    }
    if (value.type === "TSEnumDeclaration") {
      const memberList = value.members ?? (node(value.body) ? value.body.members : undefined);
      const members = Array.isArray(memberList) ? memberList : [];
      for (const member of members) {
        if (!node(member)) continue;
        const name = propertyKey(member.id);
        if (name !== undefined) {
          bind("classes", [name], own);
          bind("bindings", [name], own);
        }
      }
    }
    if (value.type === "TSEnumMember") enumValue(value.initializer);
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
      const decorators: SyntaxNode[] = [];
      const paramDecorators = (param: unknown): void => {
        if (!node(param)) return;
        if (Array.isArray(param.decorators)) decorators.push(...param.decorators.filter(node));
        if (param.type === "TSParameterProperty") paramDecorators(param.parameter);
        if (param.type === "AssignmentPattern") paramDecorators(param.left);
      };
      params.forEach(paramDecorators);
      decorators.sort((left, right) => left.start - right.start);
      let start = scope.start;
      for (const decorator of decorators) {
        if (start < decorator.start) {
          bind("parameters", bound, { ...scope, start, end: decorator.start });
          bind("bindings", bound, { ...scope, start, end: decorator.start });
        }
        start = Math.max(start, decorator.end);
      }
      if (start < scope.end) {
        bind("parameters", bound, { ...scope, start });
        bind("bindings", bound, { ...scope, start });
      }
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
      value.type === "ForStatement" || value.type === "ForInStatement" || value.type === "ForOfStatement"
    ) {
      lexical = own;
      if (value.type === "StaticBlock" || value.type === "TSModuleBlock") fn = own;
    } else if (value.type === "SwitchStatement" && node(value.discriminant)) {
      lexical = { ...own, start: value.discriminant.end };
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
  } else {
    walk(program, root, root);
    for (const value of assignments) {
      const at = node(value.right) ? value.right.start : value.start;
      assignmentValues(value.left, value.right, value.end, at);
    }
  }
  return result;
}

function sourceRanges(source: string): Ranges {
  let result = cache.get(source);
  if (!result) {
    result = collect(source);
    if (cache.size >= 128) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(source, result);
  }
  return result;
}

/** Original source offsets keep runtime bindings separate from erased TypeScript syntax. */
export function syntaxRanges(source: string, mode: ScopeMode): Range[] {
  return sourceRanges(source)[mode].map(([name, start, end]) => [name, start, end]);
}

export function syntaxAssignments(source: string): DestructuringAssignment[] {
  return sourceRanges(source).assignments.map((entry) => ({ ...entry }));
}
