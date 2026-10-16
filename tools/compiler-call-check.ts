import { parse } from "@babel/parser";
import { getBindingIdentifiers, isFunction, isNode, isReferenced, type Node } from "@babel/types";

function* nodes(value: unknown, parents?: WeakMap<Node, Node>, parent?: Node): Generator<Node> {
  if (Array.isArray(value)) {
    for (const child of value) yield* nodes(child, parents, parent);
  } else if (isNode(value)) {
    if (parent) parents?.set(value, parent);
    yield value;
    const children: readonly unknown[] = Object.values(value);
    for (const child of children) yield* nodes(child, parents, value);
  }
}

function propertyName(node: Node, computed: boolean): string | undefined {
  return !computed && node.type === "Identifier" ? node.name : node.type === "StringLiteral" ? node.value : undefined;
}

function definitionsFor(all: readonly Node[], parents: WeakMap<Node, Node>): (node: Node) => Node | undefined {
  const bindings = new WeakMap<Node, Map<string, Node>>();
  function scopeOf(node: Node | undefined, functionOnly = false): Node | undefined {
    while (node) {
      if (node.type === "Program" || isFunction(node) || (!functionOnly && ["BlockStatement", "CatchClause", "ForStatement", "ForInStatement", "ForOfStatement", "SwitchStatement"].includes(node.type))) return node;
      node = parents.get(node);
    }
    return undefined;
  }
  function bind(scope: Node | undefined, name: string, definition: Node): void {
    if (!scope) return;
    let entries = bindings.get(scope);
    if (!entries) bindings.set(scope, entries = new Map());
    entries.set(name, definition);
  }
  for (const node of all) {
    const parent = parents.get(node);
    if (node.type === "VariableDeclarator") {
      const scope = scopeOf(parent, parent?.type === "VariableDeclaration" && parent.kind === "var");
      for (const [name, id] of Object.entries(getBindingIdentifiers(node.id))) bind(scope, name, node.init ?? id);
    } else if (node.type === "ImportDeclaration") {
      for (const specifier of node.specifiers) bind(scopeOf(parent), specifier.local.name, specifier);
    } else if (node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") {
      if (node.id) bind(scopeOf(parent), node.id.name, node);
    } else if (node.type === "FunctionExpression" && node.id) {
      bind(node, node.id.name, node);
    } else if (node.type === "CatchClause" && node.param) {
      for (const [name, id] of Object.entries(getBindingIdentifiers(node.param))) bind(node, name, id);
    }
    if (isFunction(node)) {
      for (const parameter of node.params) {
        for (const [name, id] of Object.entries(getBindingIdentifiers(parameter))) bind(node, name, id);
      }
    }
  }
  return node => {
    if (node.type !== "Identifier") return undefined;
    for (let scope = parents.get(node); scope; scope = parents.get(scope)) {
      const definition = bindings.get(scope)?.get(node.name);
      if (definition) return definition;
    }
    return undefined;
  };
}

/** Follow static aliases and the module wrappers emitted by the repository's Bun builds. */
function bundledFactoryCallLeft(all: readonly Node[], definitionFor: (node: Node) => Node | undefined): boolean {
  const factories = new Set<Node>();
  const hasTransformError = all.some(node => node.type === "TemplateElement" && node.value.raw.includes("no transform has been configured"));
  if (!hasTransformError) return false;
  for (const node of all) {
    if (node.type !== "FunctionDeclaration" || !node.id) continue;
    const statement = node.body.body[0];
    const call = statement?.type === "ExpressionStatement" ? statement.expression
      : statement?.type === "ReturnStatement" ? statement.argument : undefined;
    if (node.body.body.length !== 1 || call?.type !== "CallExpression") continue;
    const callee = call.callee.type === "SequenceExpression" ? call.callee.expressions.at(-1) : call.callee;
    const name = callee?.type === "Identifier" ? callee.name
      : callee?.type === "MemberExpression" ? propertyName(callee.property, callee.computed) : undefined;
    const method = call.arguments[0];
    if (name === "NoTransformConfigurationError" && method?.type === "StringLiteral" && ["createValidate", "json.schema"].includes(method.value)) factories.add(node);
  }
  if (factories.size === 0) return false;

  const cache = new WeakMap<Node, Map<string, boolean>>();
  function resolves(node: Node, path: readonly string[] = []): boolean {
    let entries = cache.get(node);
    if (!entries) cache.set(node, entries = new Map());
    const key = JSON.stringify(path);
    if (entries.has(key)) return entries.get(key)!;
    entries.set(key, false); // Bound cycles in module aliases and reexports.
    const result = resolveValue(node, path);
    entries.set(key, result);
    return result;
  }
  function resolveValue(node: Node, path: readonly string[]): boolean {
    if (node.type === "Identifier") {
      const definition = definitionFor(node);
      if (path.length === 0 && definition && factories.has(definition)) return true;
      return definition ? resolves(definition, path) : false;
    }
    if (node.type === "MemberExpression" || node.type === "OptionalMemberExpression") {
      const property = propertyName(node.property, node.computed);
      return property !== undefined && resolves(node.object, [property, ...path]);
    }
    if (node.type === "SequenceExpression") {
      const last = node.expressions.at(-1);
      return last ? resolves(last, path) : false;
    }
    if (node.type === "ObjectExpression" && path.length > 0) {
      return node.properties.some(property => property.type === "ObjectProperty"
        && propertyName(property.key, property.computed) === path[0] && resolves(property.value, path.slice(1)));
    }
    if (node.type !== "CallExpression" || node.callee.type !== "Identifier") return false;
    const name = node.callee.name;
    const first = node.arguments[0];
    if (/^__(?:toESM|importStar)\d*$/.test(name)) {
      if (!first) return false;
      return resolves(first, path) || (path[0] === "default" && resolves(first, path.slice(1)));
    }
    if (/^__exportAll\d*$/.test(name) && first?.type === "ObjectExpression") {
      return first.properties.some(property => {
        if (property.type !== "ObjectProperty" || propertyName(property.key, property.computed) !== path[0]) return false;
        const getter = property.value;
        return getter.type === "ArrowFunctionExpression" && getter.body.type !== "BlockStatement" && resolves(getter.body, path.slice(1));
      });
    }
    const wrapper = definitionFor(node.callee);
    if (wrapper?.type !== "CallExpression" || wrapper.callee.type !== "Identifier" || !/^__commonJS\d*$/.test(wrapper.callee.name)) return false;
    const callback = wrapper.arguments[0];
    if (callback?.type !== "FunctionExpression" && callback?.type !== "ArrowFunctionExpression") return false;
    const exports = callback.params[0];
    if (exports?.type !== "Identifier" || callback.body.type !== "BlockStatement") return false;
    for (const statement of callback.body.body) {
      if (statement.type !== "ExpressionStatement") continue;
      const expression = statement.expression;
      if (expression.type === "AssignmentExpression" && expression.left.type === "MemberExpression"
        && expression.left.object.type === "Identifier" && expression.left.object.name === exports.name
        && propertyName(expression.left.property, expression.left.computed) === path[0]
        && resolves(expression.right, path.slice(1))) return true;
      if (expression.type === "CallExpression" && expression.callee.type === "Identifier" && /^__exportStar\d*$/.test(expression.callee.name)
        && expression.arguments[1]?.type === "Identifier" && expression.arguments[1].name === exports.name
        && expression.arguments[0] && resolves(expression.arguments[0], path)) return true;
    }
    return false;
  }
  return all.some(node => (node.type === "CallExpression" || node.type === "OptionalCallExpression") && resolves(node.callee));
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
  const parents = new WeakMap<Node, Node>();
  const all = [...nodes(tree, parents)];
  const definitionFor = definitionsFor(all, parents);
  const aliases = new Map<Node, string>();
  for (const node of all) {
    if (node.type === "ImportDeclaration") {
      if (compilerModule(node.source.value)) return true;
      if (node.source.value !== "typia") continue;
      for (const specifier of node.specifiers) {
        const imported = specifier.type === "ImportSpecifier"
          ? specifier.imported.type === "Identifier" ? specifier.imported.name : specifier.imported.value
          : "default";
        aliases.set(specifier, imported === "default" ? "typia" : `typia.${imported}`);
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
    if (node.type === "Identifier") {
      const definition = definitionFor(node);
      return definition ? aliases.get(definition) : node.name === "typia" ? "typia" : undefined;
    }
    if (node.type !== "MemberExpression" && node.type !== "OptionalMemberExpression") return undefined;
    const object = reference(node.object);
    const property = !node.computed && node.property.type === "Identifier"
      ? node.property.name
      : node.computed && node.property.type === "StringLiteral" ? node.property.value : undefined;
    return object && property ? `${object}.${property}` : undefined;
  }

  for (const node of all) {
    const parent = parents.get(node);
    if (node.type === "Identifier" && parent && !isReferenced(node, parent, parents.get(parent))) continue;
    const name = reference(node);
    if (name === "typia.createValidate" || name === "typia.json.schema") return true;
  }
  return bundledFactoryCallLeft(all, definitionFor);
}
