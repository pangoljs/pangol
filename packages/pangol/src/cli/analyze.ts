// What a handler reads from its context `c`, from the TypeScript AST of the function's own source
// (Function.prototype.toString), so it works the same for routes built by helpers and is not fooled
// by a renamed parameter, destructuring or an alias. When `c` goes somewhere it cannot follow (passed
// to a function, spread, stored), `escapes` is true and rules that need a "never reads" answer skip.
import type TS from 'typescript'

export interface Analysis {
  readonly reads: ReadonlySet<string>
  readonly escapes: boolean
  /** Literal statuses given to c.fail(); 'unknown' when the status is not a number literal. */
  readonly failStatuses: readonly (number | 'unknown')[]
}

const UNKNOWN: Analysis = { reads: new Set(), escapes: true, failStatuses: [] }

type Fn = TS.ArrowFunction | TS.FunctionExpression | TS.MethodDeclaration

function parse(ts: typeof TS, source: string): Fn | undefined {
  // `(c) => …` and `function (c) {…}` parse as expressions; method shorthand `handler(c) {…}` as a member
  for (const [text, pick] of [
    [`(${source})`, (s: TS.Statement) => ts.isExpressionStatement(s) && ts.isParenthesizedExpression(s.expression) ? s.expression.expression : undefined],
    [`({${source}})`, (s: TS.Statement) => ts.isExpressionStatement(s) && ts.isParenthesizedExpression(s.expression) && ts.isObjectLiteralExpression(s.expression.expression) ? s.expression.expression.properties[0] : undefined],
  ] as const) {
    const file = ts.createSourceFile('handler.js', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
    if ((file as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics.length > 0 || file.statements.length !== 1) continue
    const node = pick(file.statements[0] as TS.Statement)
    if (node !== undefined && (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isMethodDeclaration(node))) return node
  }
  return undefined
}

export function analyze(ts: typeof TS, fn: (...args: never[]) => unknown): Analysis {
  const node = parse(ts, Function.prototype.toString.call(fn))
  if (node === undefined) return UNKNOWN // e.g. a bound function: "[native code]"
  const reads = new Set<string>()
  const failStatuses: (number | 'unknown')[] = []
  const aliases = new Set<string>() // names that hold the context
  const fails = new Set<string>() // names that hold c.fail
  let escapes = false

  const recordFail = (call: TS.Node) => {
    if (!ts.isCallExpression(call)) return
    const status = call.arguments[0]
    failStatuses.push(status !== undefined && ts.isNumericLiteral(status) ? Number(status.text) : 'unknown')
  }
  const bind = (name: TS.BindingName) => {
    if (ts.isIdentifier(name)) { aliases.add(name.text); return }
    if (ts.isArrayBindingPattern(name)) { escapes = true; return }
    for (const element of name.elements) {
      if (element.dotDotDotToken !== undefined) { escapes = true; continue }
      const key = element.propertyName ?? element.name
      if (ts.isIdentifier(key) || ts.isStringLiteral(key)) {
        reads.add(key.text)
        if (key.text === 'fail' && ts.isIdentifier(element.name)) fails.add(element.name.text)
      } else escapes = true
    }
  }

  const [param] = node.parameters
  if (param !== undefined) {
    if (param.dotDotDotToken !== undefined) return UNKNOWN
    bind(param.name)
  }

  const isDeclarationName = (id: TS.Identifier, parent: TS.Node) =>
    ((parent as { name?: TS.Node }).name === id && !ts.isShorthandPropertyAssignment(parent)) ||
    (ts.isBindingElement(parent) && parent.propertyName === id)

  const visit = (n: TS.Node): void => {
    if (ts.isIdentifier(n) && n.parent !== undefined && !isDeclarationName(n, n.parent)) {
      const parent = n.parent
      if (fails.has(n.text) && ts.isCallExpression(parent) && parent.expression === n) recordFail(parent)
      if (aliases.has(n.text)) {
        if (ts.isPropertyAccessExpression(parent) && parent.expression === n) {
          reads.add(parent.name.text)
          if (parent.name.text === 'fail' && parent.parent !== undefined && ts.isCallExpression(parent.parent) && parent.parent.expression === parent) recordFail(parent.parent)
        } else if (ts.isElementAccessExpression(parent) && parent.expression === n) {
          const key = parent.argumentExpression
          if (ts.isStringLiteral(key) || ts.isNoSubstitutionTemplateLiteral(key)) reads.add(key.text)
          else escapes = true
        } else if (ts.isVariableDeclaration(parent) && parent.initializer === n) {
          bind(parent.name)
        } else {
          escapes = true // passed, returned, spread, stored or reassigned: cannot follow it
        }
      }
    }
    ts.forEachChild(n, visit)
  }
  if (node.body !== undefined) visit(node.body)
  return { reads, escapes, failStatuses }
}
