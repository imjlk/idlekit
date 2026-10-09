import { parse } from "@babel/parser";

export type ScopeMode =
  | "bindings" | "parameters" | "classes" | "functions"
  | "annotations" | "enumValues" | "destructuring" | "objectMethods" | "containerReferences" | "fieldKeys" | "imports" | "callArguments";
type Range = [string, number, number];
export type DestructuringAssignment = {
  name: string;
  at: number;
  end: number;
  evaluation: "value" | "default" | "opaque" | "rest";
  restValues?: number[];
  start?: number;
};
type Ranges = Record<ScopeMode, Range[]> & {
  assignments: DestructuringAssignment[];
  alternatives: Map<number, number[]>;
};
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
    fieldKeys: [],
    imports: [],
    callArguments: [],
    assignments: [],
    alternatives: new Map(),
  };
  const undefinedBindings: Range[] = [];
  const assignments: SyntaxNode[] = [];
  const root: Scope = { start: 0, end: source.length, root: true };
  const bind = (mode: ScopeMode, values: string[], scope: Scope): void => {
    for (const name of values) {
      result[mode].push([name, scope.start, scope.end]);
      if (name === "undefined" && ["bindings", "parameters", "classes", "functions", "destructuring", "imports"].includes(mode)) {
        undefinedBindings.push([name, scope.start, scope.end]);
      }
    }
  };
  const annotation = (value: unknown): void => {
    if (node(value)) result.annotations.push(["", value.start, value.end]);
  };
  const logicalAlternatives = (value: SyntaxNode): unknown[] => {
    let left = value.left;
    while (node(left) && ["TSAsExpression", "TSSatisfiesExpression", "TSNonNullExpression", "TSTypeAssertion", "ParenthesizedExpression"].includes(left.type)) {
      left = left.expression;
    }
    let truthy: boolean | undefined;
    let nullish: boolean | undefined;
    if (node(left)) {
      if (["BooleanLiteral", "NumericLiteral", "StringLiteral"].includes(left.type)) {
        truthy = Boolean(left.value);
        nullish = false;
      } else if (left.type === "NullLiteral" || left.type === "UnaryExpression" && left.operator === "void") {
        truthy = false;
        nullish = true;
      } else if ([
        "ObjectExpression", "ArrayExpression", "FunctionExpression", "ArrowFunctionExpression",
        "ClassExpression", "NewExpression", "RegExpLiteral",
      ].includes(left.type)) {
        truthy = true;
        nullish = false;
      }
    }
    // A falsy && result cannot itself hold a callable runner or a runner object.
    if (value.operator === "&&") return truthy === false ? [] : [value.right];
    if (value.operator === "||") {
      if (truthy === true) return [value.left];
      if (truthy === false) return [value.right];
    } else {
      if (nullish === false) return [value.left];
      if (nullish === true) return [value.right];
    }
    return [value.left, value.right];
  };
  const containerReference = (value: unknown): void => {
    if (!node(value)) return;
    let bare = value;
    while (["TSAsExpression", "TSSatisfiesExpression", "TSNonNullExpression", "TSTypeAssertion", "ParenthesizedExpression"].includes(bare.type) && node(bare.expression)) {
      bare = bare.expression;
    }
    if (bare.type === "Identifier") bind("containerReferences", names(bare), { start: value.start, end: value.end, root: false });
    let alternatives: unknown[] = [];
    if (bare.type === "ConditionalExpression") alternatives = [bare.consequent, bare.alternate];
    else if (bare.type === "LogicalExpression") alternatives = logicalAlternatives(bare);
    else if (bare.type === "SequenceExpression" && Array.isArray(bare.expressions)) {
      alternatives = bare.expressions.slice(-1);
    }
    if (alternatives.length > 0 || bare.type === "LogicalExpression") {
      const branches: SyntaxNode[] = [];
      const leaves = (branch: unknown): void => {
        if (!node(branch)) return;
        if (["TSAsExpression", "TSSatisfiesExpression", "TSNonNullExpression", "TSTypeAssertion", "ParenthesizedExpression"].includes(branch.type) && node(branch.expression)) {
          leaves(branch.expression);
        } else if (branch.type === "ConditionalExpression") {
          leaves(branch.consequent);
          leaves(branch.alternate);
        } else if (branch.type === "LogicalExpression") {
          logicalAlternatives(branch).forEach(leaves);
        } else if (branch.type === "SequenceExpression" && Array.isArray(branch.expressions)) {
          leaves(branch.expressions.at(-1));
        } else branches.push(branch);
      };
      alternatives.forEach(leaves);
      branches.forEach(containerReference);
      const starts = branches.map((branch) => branch.start);
      result.alternatives.set(value.start, starts);
    }
  };
  const propertyKey = (value: unknown, computed = false): string | undefined => {
    if (!node(value)) return undefined;
    if (value.type === "Identifier" && !computed) return names(value)[0];
    if (value.type === "StringLiteral" && typeof value.value === "string") return value.value;
    if (value.type === "NumericLiteral" && typeof value.value === "number") return String(value.value);
    if (value.type === "BigIntLiteral" && (typeof value.value === "string" || typeof value.value === "bigint")) return String(BigInt(value.value));
    if (value.type === "BooleanLiteral" && typeof value.value === "boolean") return String(value.value);
    if (value.type === "NullLiteral") return "null";
    return undefined;
  };
  const prototypeSetter = (value: SyntaxNode): boolean =>
    value.type === "ObjectProperty" && !value.computed && !value.shorthand && propertyKey(value.key) === "__proto__";
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
        if (target.type === "RestElement" && literal && properties.every((entry) => node(entry) && entry.type !== "SpreadElement" && propertyKey(entry.key, entry.computed === true) !== undefined)) {
          const excluded = pattern.properties.filter(node).filter((entry) =>
            entry.type !== "RestElement",
          );
          const excludedKeys = excluded.map((entry) => {
            return propertyKey(entry.key, entry.computed === true);
          });
          if (excludedKeys.every((key) => key !== undefined)) {
            const keys = new Set(excludedKeys);
            const retained = new Map<string, unknown>();
            for (const entry of properties) {
              if (!node(entry) || prototypeSetter(entry)) continue;
              const key = propertyKey(entry.key, entry.computed === true);
              if (key !== undefined && !keys.has(key)) retained.set(key, entry.value);
            }
            const restValues = [...retained.values()].filter(node).map((entry) => entry.start);
            for (const name of names(target.argument)) result.assignments.push({
              name, at: value.start, end, evaluation: "rest", restValues,
            });
            continue;
          }
        }
        let source: unknown = literal ? null : undefined;
        const key = propertyKey(target.key, target.computed === true);
        if (key !== undefined && Object.hasOwn(Object.prototype, key)) source = undefined;
        if (key !== undefined) {
          for (const candidate of [...properties].reverse()) {
            if (!node(candidate)) continue;
            const candidateKey = propertyKey(candidate.key, candidate.computed === true);
            if (candidate.type === "SpreadElement" || candidateKey === undefined) {
              source = undefined;
              break;
            }
            if (prototypeSetter(candidate)) {
              source = undefined;
              continue;
            }
            if (candidateKey !== key) continue;
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
        if (literal && node(target) && target.type === "RestElement") {
          const restValues = elements.slice(index).filter(node).map((entry) => entry.start);
          for (const name of names(target.argument)) result.assignments.push({
            name, at: value.start, end, evaluation: "rest", restValues,
          });
          return;
        }
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
    if (value.type === "ReturnStatement") containerReference(value.argument);
    if (value.type === "SpreadElement") containerReference(value.argument);
    if (value.type === "ArrayExpression" && Array.isArray(value.elements)) value.elements.forEach(containerReference);
    if (["CallExpression", "OptionalCallExpression", "NewExpression"].includes(value.type) && Array.isArray(value.arguments)) {
      for (const argument of value.arguments) {
        if (!node(argument)) continue;
        containerReference(argument);
        result.callArguments.push(["", argument.start, argument.end]);
      }
    }
    if (["ClassProperty", "ClassPrivateProperty", "ClassAccessorProperty"].includes(value.type)) {
      containerReference(value.value);
      if (!value.computed && node(value.key)) result.fieldKeys.push(["", value.key.start, value.key.end]);
    }
    if (value.type === "TSTypeAnnotation" || value.type === "TSTypeParameterDeclaration") {
      annotation(value);
      return;
    }
    if ((value.type === "ImportDeclaration" || value.type === "TSImportEqualsDeclaration" || value.type === "ImportSpecifier") &&
        (value.importKind === "type" || value.isTypeOnly === true)) {
      annotation(value);
      return;
    }
    if (typeDeclarations.has(value.type) || value.type === "TSModuleDeclaration" && value.declare === true) {
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
    if ([
      "ImportSpecifier", "ImportDefaultSpecifier", "ImportNamespaceSpecifier",
    ].includes(value.type)) {
      bind("imports", names(value.local), lexical);
    }
    if (value.type === "TSImportEqualsDeclaration") bind("imports", names(value.id), lexical);
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
    const pureValue = (value: unknown): boolean => {
      if (!node(value)) return value === null;
      if (["Identifier", "StringLiteral", "NumericLiteral", "BooleanLiteral", "NullLiteral", "BigIntLiteral", "RegExpLiteral", "FunctionExpression", "ArrowFunctionExpression"].includes(value.type)) return true;
      if (["TSAsExpression", "TSSatisfiesExpression", "TSNonNullExpression", "TSTypeAssertion", "ParenthesizedExpression"].includes(value.type)) return pureValue(value.expression);
      if (value.type === "ArrayExpression" && Array.isArray(value.elements)) return value.elements.every(pureValue);
      if (value.type === "ObjectExpression" && Array.isArray(value.properties)) {
        return value.properties.every((entry) => node(entry) && entry.type === "ObjectProperty" &&
          propertyKey(entry.key, entry.computed === true) !== undefined && pureValue(entry.value));
      }
      return false;
    };
    for (const value of assignments) {
      const at = node(value.right) ? value.right.start : value.start;
      const before = result.assignments.length;
      assignmentValues(value.left, value.right, value.end, at);
      if (pureValue(value.right)) {
        for (const entry of result.assignments.slice(before)) entry.start = value.start;
      }
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

export function syntaxAlternatives(source: string, at: number): number[] | undefined {
  const alternatives = sourceRanges(source).alternatives.get(at);
  return alternatives === undefined ? undefined : [...alternatives];
}
