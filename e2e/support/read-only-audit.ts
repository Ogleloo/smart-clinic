/**
 * Static audit for READ-ONLY live specs — the specs that run by default against whatever backend the app is wired to,
 * possibly the shared (production) project. It parses the spec with the TypeScript compiler, so comments, chained locators,
 * multi-line calls and string/regex literals are understood structurally, not guessed at with regular expressions.
 *
 * POLICY: DENY BY DEFAULT. The earlier detector listed dangerous button labels (Skip, Save, …) and let everything else
 * through; a control called "Complete" or "Add service" — or a click through getByText, a CSS selector, a variable, an
 * Enter key press, an APIRequestContext POST — went unnoticed. This one lists what a read-only spec MAY do, and rejects
 * every other submission-capable or ambiguous interaction:
 *
 *  - CLICK / DBLCLICK / TAP only on a locator that resolves, inside the same file, to
 *      · a link (a link navigates with GET), or
 *      · a button whose literal accessible name is on the allowlist below (Sign Out / Log out everywhere; a handful of named
 *        client-side controls per spec), or
 *      · a selector on the per-spec selector allowlist.
 *    Anything else — getByText/getByLabel/getByTestId/CSS/`page.click(selector)`/element handles, a name built from a variable
 *    or template, a receiver that is a parameter or loop variable — is denied.
 *  - KEYS: only navigation keys (Tab, Escape, arrows, Home/End/PageUp/PageDown). Enter and Space submit forms and activate
 *    buttons, so they are denied, as is typing key by key.
 *  - evaluate()/waitForFunction() callbacks may only READ the page (a fixed list of DOM/JS read calls, no assignments to
 *    properties, no click/submit/fetch).
 *  - NO other way to talk to a server: fetch/XHR, APIRequestContext (`request`, `page.request`), page/context routes,
 *    new browser contexts, init scripts, extra headers, forms submitted programmatically, Server Action handling
 *    ("next-action"), forged or rewritten requests, password typing, submit-button selectors.
 *  - IMPORTS only from a short allowlist; `./helpers` only for the sign-in helpers, which are themselves audited
 *    (auditReadOnlyHelpers) with a few exact, reviewed exemptions.
 *
 * It is still static: it cannot see what a permitted click ends up calling, and a Server Action's writes are invisible to
 * the browser-level guard (safe-test.ts). That residual risk is why the allowlist is short and why every entry is a reviewed
 * decision in this file, not an annotation inside a spec.
 */
import * as ts from 'typescript'

// ---------------------------------------------------------------------------------------------------- policy

/** Sign-in helpers a read-only spec may import from ./helpers. Their bodies are audited by auditReadOnlyHelpers(). */
export const READ_ONLY_HELPERS = ['ACCOUNTS', 'loginAs', 'waitSettled', 'chooseBookingService', 'pickBookingDate'] as const

/**
 * Button names a read-only spec may click: client-side or session-only controls. Matched against the LITERAL name
 * (a string, or a regular expression's source). Everywhere: signing out. Elsewhere: only the named spec.
 */
export const CLICK_ALLOW_EVERYWHERE: readonly RegExp[] = [/^sign out$/i, /^log out$/i]
export const CLICK_ALLOW_BY_SPEC: Readonly<Record<string, { buttons?: readonly RegExp[]; selectors?: readonly string[] }>> = {
  // "Show reasons" discloses a list that is already on the page.
  'admin-v2': { buttons: [/^show reasons$/i] },
  // Cancel discards unsaved edits in the form; Change Password only expands/collapses the (validation-only) panel.
  'reception-profile': { buttons: [/^cancel$/i, /^change password$/i] },
  // Client-side service filters on the queue table; they are the only aria-pressed buttons on that page.
  'reception-queue': { buttons: [/^all services$/i], selectors: ['button[aria-pressed]'] },
}

/** Keys that move focus or dismiss; they cannot submit a form or activate a button. */
const SAFE_KEY = /^(Shift\+)?(Tab|Escape|Home|End|PageUp|PageDown|Arrow(Up|Down|Left|Right))$/

/**
 * Exact statements that the sign-in/booking helpers may contain although the general rules would deny them. Compared with
 * the statement's whitespace-normalised source text, so a changed argument is no longer exempt.
 */
export const APPROVED_HELPER_CALLS: readonly string[] = [
  `page.fill('input[name="password"]', password)`, // sign-in
  `page.click('button[type="submit"]')`, // sign-in (the Auth session is the only thing it creates)
  `page.getByText(serviceName, { exact: true }).click()`, // booking wizard step 1: choose a service card (client state)
  `page.getByRole('button', { name: 'Continue' }).click()`, // booking wizard: go to the calendar step (client state + read RPC)
  `day.click()`, // booking calendar: pick a day (client state + read RPC for slots)
  `page.getByRole('button', { name: 'Next month' }).click()`, // calendar paging
]

/** Modules a read-only spec may import, and what from them. */
const IMPORTS: Record<string, { values?: readonly string[] }> = {
  '@playwright/test': { values: ['expect'] }, // types are always fine; `test` must come from ./support/safe-test
  './support/safe-test': { values: ['test', 'expect'] },
  './support/observe-actions': { values: ['observeServerActions'] },
  './helpers': { values: READ_ONLY_HELPERS },
}
/** App code imported for expected values (pure functions/constants). App route code (../app) is not allowed. */
const IMPORT_PREFIXES = ['../lib/', '../components/']
/** One reviewed exception: this spec renders component states in a child process (tsx) to compare against the live page. */
const IMPORT_EXTRA_BY_SPEC: Record<string, readonly string[]> = { 'nurse-v3-dashboard': ['node:child_process'] }

/** Members that talk to a server, rewrite traffic, or submit — denied wherever they appear. */
const BANNED_MEMBERS = new Set([
  'route', 'routeFromHAR', 'routeWebSocket', 'newContext', 'launch', 'launchPersistentContext', 'connect', 'connectOverCDP',
  'addInitScript', 'exposeFunction', 'exposeBinding', 'setExtraHTTPHeaders', 'dispatchEvent', 'requestSubmit', 'dragTo',
  'setInputFiles', 'selectOption', 'setChecked', 'pressSequentially', 'evaluateHandle', '$', '$$', '$eval', '$$eval',
  'elementHandle', 'elementHandles', 'mouse', 'touchscreen', 'sendBeacon', 'fetch',
])
/** Members denied only when CALLED (the name is also an innocent property elsewhere, e.g. ConsoleMessage.type()). */
const BANNED_CALLS = new Set(['type', 'check', 'uncheck', 'submit', 'accept', 'continue', 'fulfill', 'down', 'up', 'insertText'])
/** …and for these, only when called WITH arguments (`locator.type('x')`, `keyboard.down('Enter')`, not `msg.type()`). */
const BANNED_CALLS_WITH_ARGS = new Set(['type', 'down', 'up', 'insertText'])
const BANNED_GLOBALS = new Set(['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'require', 'eval', 'importScripts'])
const BANNED_FIXTURES = new Set(['browser', 'request', 'playwright'])

/** Calls an evaluate()/waitForFunction() callback may make: they only read the DOM or compute. */
const PAGE_READ_CALLS = new Set([
  'querySelector', 'querySelectorAll', 'getElementById', 'getElementsByTagName', 'getComputedStyle', 'getBoundingClientRect',
  'getClientRects', 'getAttribute', 'hasAttribute', 'getPropertyValue', 'closest', 'matches', 'contains',
  'map', 'filter', 'some', 'every', 'find', 'findIndex', 'reduce', 'flatMap', 'slice', 'sort', 'join', 'concat', 'forEach', 'at',
  'includes', 'indexOf', 'keys', 'values', 'entries', 'from', 'isArray', 'has', 'get', 'getAll',
  'trim', 'startsWith', 'endsWith', 'replace', 'test', 'match', 'split', 'toLowerCase', 'toUpperCase', 'toString', 'toFixed',
  'Number', 'String', 'Boolean', 'parseInt', 'parseFloat', 'round', 'floor', 'ceil', 'max', 'min', 'abs',
])
const PAGE_NEW_OK = new Set(['FormData', 'Set', 'Map', 'Array', 'Date', 'RegExp', 'URL', 'URLSearchParams'])

/** Names of controls that submit or change something — kept as a second line of defence: such a control may be ASSERTED on, never stored or used. */
const MUTATING_CONTROL =
  /\b(skip|save|update password|create account|register|sign up|confirm|book|check.?in|call next|next patient|undo|record|emergency|start session|end session|go (on|off) duty|off duty|on duty|remove photo|upload|submit|send|delete|remove|approve|merge|invite|revoke|reset|cancel (appointment|booking)|pay)\b/i

// ---------------------------------------------------------------------------------------------------- engine

type Options = { spec?: string; approved?: readonly string[] }

const isStringish = (n: ts.Node | undefined): n is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | ts.TemplateExpression =>
  !!n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n))

function literalText(n: ts.Node | undefined): string | undefined {
  if (!n) return undefined
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text
  // a regular expression is compared by its source without the ^ $ anchors (`/^Log out$/` names the same button as 'Log out')
  if (ts.isRegularExpressionLiteral(n)) return /^\/([^]*)\/[a-z]*$/.exec(n.text)?.[1]?.replace(/^\^/, '').replace(/\$$/, '')
  return undefined
}

function unwrap(e: ts.Expression): ts.Expression {
  let x = e
  while (ts.isParenthesizedExpression(x) || ts.isNonNullExpression(x) || ts.isAsExpression(x) || ts.isAwaitExpression(x) || ts.isTypeAssertionExpression(x)) x = x.expression
  return x
}

function audit(sf: ts.SourceFile, root: ts.Node, options: Options): string[] {
  const findings: string[] = []
  const norm = (n: ts.Node) => n.getText(sf).replace(/\s+/g, ' ')
  const approvedRanges: Array<[number, number]> = []
  const approved = new Set((options.approved ?? []).map((a) => a.replace(/\s+/g, ' ')))
  const inApproved = (n: ts.Node) => approvedRanges.some(([a, b]) => n.getStart(sf) >= a && n.getEnd() <= b)
  const add = (n: ts.Node, message: string) => {
    if (inApproved(n)) return
    const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1
    const f = `L${line}: ${message}`
    if (!findings.includes(f)) findings.push(f)
  }

  // ---- declarations in this file, so a click on `const x = page.getByRole(...)` can be traced to the locator
  const decls = new Map<string, { inits: ts.Expression[]; other: boolean }>()
  const entry = (name: string) => {
    let e = decls.get(name)
    if (!e) decls.set(name, (e = { inits: [], other: false }))
    return e
  }
  const collect = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n)) {
      if (ts.isIdentifier(n.name)) {
        if (n.initializer && !ts.isForOfStatement(n.parent.parent) && !ts.isForInStatement(n.parent.parent)) entry(n.name.text).inits.push(n.initializer)
        else entry(n.name.text).other = true
      } else markBindings(n.name)
    } else if (ts.isParameter(n)) {
      if (ts.isIdentifier(n.name)) entry(n.name.text).other = true
      else markBindings(n.name)
    } else if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(n.left)) {
      entry(n.left.text).other = true
    } else if (ts.isCatchClause(n) && n.variableDeclaration && ts.isIdentifier(n.variableDeclaration.name)) {
      entry(n.variableDeclaration.name.text).other = true
    }
    ts.forEachChild(n, collect)
  }
  const markBindings = (b: ts.BindingName) => {
    if (ts.isIdentifier(b)) entry(b.text).other = true
    else for (const el of b.elements) if (ts.isBindingElement(el)) markBindings(el.name)
  }
  collect(sf)

  // ---- click target resolution: returns null when the target is an allowed control, otherwise the reason
  const spec = options.spec ? CLICK_ALLOW_BY_SPEC[options.spec] : undefined
  const buttonAllowed = (name: string) => CLICK_ALLOW_EVERYWHERE.some((r) => r.test(name)) || !!spec?.buttons?.some((r) => r.test(name))
  const resolve = (e: ts.Expression, depth: number): string | null => {
    if (depth > 8) return 'the locator is too deeply nested to analyse'
    const x = unwrap(e)
    if (ts.isCallExpression(x) && ts.isPropertyAccessExpression(x.expression)) {
      const method = x.expression.name.text
      if (['first', 'last', 'nth', 'filter'].includes(method)) return resolve(x.expression.expression, depth + 1)
      if (method === 'getByRole') {
        const role = literalText(x.arguments[0])
        if (role === 'link') {
          // A link navigates with GET. A link NAMED like a write is more likely a button in disguise: refuse it rather than guess.
          const linkName = literalText(
            (x.arguments[1] && ts.isObjectLiteralExpression(x.arguments[1])
              ? x.arguments[1].properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && !!p.name && p.name.getText(sf) === 'name')
              : undefined
            )?.initializer
          )
          return linkName !== undefined && MUTATING_CONTROL.test(linkName) ? `clicks the link "${linkName}", whose name suggests a write` : null
        }
        if (role !== 'button') return `clicks a ${role ? `"${role}"` : 'non-literal role'} element`
        const opts = x.arguments[1]
        const nameProp =
          opts && ts.isObjectLiteralExpression(opts)
            ? opts.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && !!p.name && p.name.getText(sf) === 'name')
            : undefined
        const name = literalText(nameProp?.initializer)
        if (name === undefined) return 'clicks a button whose name is not a literal (a variable, a template or missing)'
        return buttonAllowed(name) ? null : `clicks the button "${name}", which is not on the read-only click allowlist`
      }
      if (method === 'locator') {
        const sel = literalText(x.arguments[0])
        if (sel !== undefined && spec?.selectors?.includes(sel)) return null
        return `clicks a raw selector ${sel === undefined ? '(non-literal)' : `"${sel}"`}, which is not on the read-only selector allowlist`
      }
      return `clicks through .${method}(), which cannot be shown to be a link or an allowlisted button`
    }
    if (ts.isIdentifier(x)) {
      const d = decls.get(x.text)
      if (!d || d.other || d.inits.length === 0) return `clicks "${x.text}", which is not a locator declared once in this file`
      for (const init of d.inits) {
        const r = resolve(init, depth + 1)
        if (r) return r
      }
      return null
    }
    return `clicks "${norm(x).slice(0, 60)}", which cannot be resolved to an allowed control`
  }

  // ---- evaluate()/waitForFunction() callbacks may only read
  const checkPageCallback = (fn: ts.Node) => {
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n)) {
        const c = n.expression
        const name = ts.isIdentifier(c) ? c.text : ts.isPropertyAccessExpression(c) ? c.name.text : undefined
        if (!name || !PAGE_READ_CALLS.has(name)) add(n, `an evaluate() callback calls ${norm(c).slice(0, 50)}(), which is not a read-only page call`)
      } else if (ts.isNewExpression(n)) {
        if (!ts.isIdentifier(n.expression) || !PAGE_NEW_OK.has(n.expression.text)) add(n, `an evaluate() callback constructs ${norm(n.expression)}`)
      } else if (ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
        const bad = !ts.isIdentifier(n.left) || ['location', 'document', 'window', 'history'].includes(n.left.text)
        if (bad) add(n, 'an evaluate() callback assigns to a page property')
      } else if (ts.isDeleteExpression(n)) {
        add(n, 'an evaluate() callback deletes a property')
      } else if ((ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) && (n.operator === ts.SyntaxKind.PlusPlusToken || n.operator === ts.SyntaxKind.MinusMinusToken) && !ts.isIdentifier(n.operand)) {
        add(n, 'an evaluate() callback mutates a page property')
      }
      ts.forEachChild(n, visit)
    }
    visit(fn)
  }

  const importCheck = (n: ts.ImportDeclaration | ts.ExportDeclaration) => {
    const mod = n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier) ? n.moduleSpecifier.text : undefined
    if (ts.isExportDeclaration(n)) return add(n, `re-exports from ${mod ?? 'a module'}`)
    if (!mod) return add(n, 'imports a non-literal module')
    const clause = n.importClause
    if (clause?.isTypeOnly) return
    const allowed = IMPORTS[mod]
    const extra = options.spec ? IMPORT_EXTRA_BY_SPEC[options.spec] : undefined
    if (extra?.includes(mod) || IMPORT_PREFIXES.some((p) => mod.startsWith(p))) return
    if (!allowed) return add(n, `imports "${mod}", which is not on the read-only import allowlist`)
    if (!clause) return add(n, `imports "${mod}" for side effects`)
    if (clause.name || (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings))) return add(n, `imports "${mod}" as a default/namespace import`)
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const el of clause.namedBindings.elements) {
        if (el.isTypeOnly) continue
        const imported = (el.propertyName ?? el.name).text
        if (!allowed.values?.includes(imported)) add(el, `imports ${imported} from "${mod}", which a read-only spec may not use`)
      }
    }
  }

  // first pass: statements that are exempt as a whole
  const markApproved = (n: ts.Node) => {
    if (ts.isCallExpression(n) && approved.has(norm(n))) approvedRanges.push([n.getStart(sf), n.getEnd()])
    ts.forEachChild(n, markApproved)
  }
  markApproved(root)

  const visit = (n: ts.Node) => {
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) importCheck(n)

    if (ts.isIdentifier(n)) {
      const isMemberName = ts.isPropertyAccessExpression(n.parent) && n.parent.name === n
      const isPropKey = (ts.isPropertyAssignment(n.parent) || ts.isBindingElement(n.parent)) && n.parent.name === n
      if (!isMemberName && !isPropKey && BANNED_GLOBALS.has(n.text)) add(n, `uses ${n.text}, a way to reach a server without the browser guard`)
      if (/^forge/i.test(n.text) || n.text === 'postData') add(n, 'rewrites or forges requests')
    }

    if (ts.isBindingElement(n) && ts.isObjectBindingPattern(n.parent)) {
      const name = (n.propertyName ?? n.name).getText(sf)
      if (BANNED_FIXTURES.has(name)) add(n, `takes the "${name}" fixture, which gives a spec an unguarded way to reach a server`)
    }

    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) {
      const t = n.text
      if (/next-action/i.test(t)) add(n, 'tracks or handles Server Action POSTs ("next-action")')
      if (/\[type=["']?submit["']?\]/i.test(t)) add(n, 'targets a form submit button by selector')
    }

    if (ts.isPropertyAccessExpression(n)) {
      const m = n.name.text
      const called = ts.isCallExpression(n.parent) && n.parent.expression === n
      if (BANNED_MEMBERS.has(m)) add(n, `uses .${m}, which can submit data or bypass the browser-request guard`)
      if (m === 'request' && !called) add(n, 'uses .request (APIRequestContext), which sends requests the browser guard cannot see')
      if (called && BANNED_CALLS.has(m) && !(BANNED_CALLS_WITH_ARGS.has(m) && (n.parent as ts.CallExpression).arguments.length === 0)) {
        add(n, `calls .${m}(), which can submit or confirm something`)
      }
      if (ts.isIdentifier(n.expression) && BANNED_FIXTURES.has(n.expression.text) && n.expression.text !== 'playwright') add(n, `uses ${n.expression.text}.${m}`)
    }

    if (ts.isCallExpression(n)) {
      const c = n.expression
      if (c.kind === ts.SyntaxKind.ImportKeyword) add(n, 'uses a dynamic import()')
      if (ts.isPropertyAccessExpression(c)) {
        const m = c.name.text
        const args = n.arguments

        if (m === 'click' || m === 'dblclick' || m === 'tap') {
          if (isStringish(args[0])) add(n, `clicks by selector string (${norm(n).slice(0, 60)}), which cannot be shown to be harmless`)
          else {
            const r = resolve(c.expression, 0)
            if (r) add(n, r)
          }
        } else if (m === 'press') {
          const keyArg = args.length >= 2 && literalText(args[1]) !== undefined && !ts.isObjectLiteralExpression(args[1]) ? args[1] : args[0]
          const key = literalText(keyArg)
          if (key === undefined) add(n, 'presses a key that is not a literal')
          else if (!SAFE_KEY.test(key)) add(n, `presses "${key}", which can submit a form or activate a button (only navigation keys are allowed)`)
        } else if (m === 'fill') {
          const strings: string[] = []
          const grab = (x: ts.Node) => {
            if (ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x)) strings.push(x.text)
            ts.forEachChild(x, grab)
          }
          grab(c.expression)
          if (args[0]) grab(args[0])
          if (strings.some((s) => /password/i.test(s))) add(n, 'types into a password field')
        } else if (m === 'evaluate' || m === 'evaluateAll' || m === 'waitForFunction') {
          const fn = args.find((a) => ts.isArrowFunction(a) || ts.isFunctionExpression(a))
          if (!fn) add(n, `${m}() with a callback that is not an inline function cannot be audited`)
          else checkPageCallback(fn)
        }
      }
    }

    // a control whose name suggests a write may be asserted on (inside expect(...)), never stored or used
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'getByRole' && literalText(n.arguments[0]) === 'button') {
      const opts = n.arguments[1]
      const nameProp = opts && ts.isObjectLiteralExpression(opts) ? opts.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && !!p.name && p.name.getText(sf) === 'name') : undefined
      const name = literalText(nameProp?.initializer)
      if (name !== undefined && MUTATING_CONTROL.test(name)) {
        let p: ts.Node | undefined = n.parent
        let asserted = false
        let stored = false
        while (p && !ts.isSourceFile(p)) {
          if (ts.isCallExpression(p) && ts.isIdentifier(p.expression) && p.expression.text === 'expect') asserted = true
          if (ts.isVariableDeclaration(p)) {
            stored = true
            break
          }
          p = p.parent
        }
        if (stored && !asserted) add(n, `stores the "${name}" control, a mutation-capable button, for later use`)
      }
    }

    ts.forEachChild(n, visit)
  }
  visit(root)
  return findings
}

function parse(source: string): ts.SourceFile {
  return ts.createSourceFile('audited.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}

const syntaxErrors = (sf: ts.SourceFile): string[] =>
  ((sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? []).map((d) => `syntax error: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`)

// ---------------------------------------------------------------------------------------------------- public API

/**
 * Everything a read-only spec may not do: returns one finding per offending construct, with its line number. Empty means the
 * spec does only what the policy above permits. `spec` selects the per-spec click allowlist; `approved` is for the
 * helper audit only.
 */
export function findMutationSubmissions(source: string, options: Options = {}): string[] {
  const sf = parse(source)
  const bad = syntaxErrors(sf)
  if (bad.length) return bad
  return audit(sf, sf, options)
}

/**
 * Audits the bodies of the sign-in/booking helpers a read-only spec is allowed to import, with the reviewed exemptions in
 * APPROVED_HELPER_CALLS. A helper that disappears from the file, or grows a new interaction, is reported.
 */
export function auditReadOnlyHelpers(helpersSource: string): string[] {
  const sf = parse(helpersSource)
  const findings = syntaxErrors(sf)
  for (const name of READ_ONLY_HELPERS) {
    const node = sf.statements.find(
      (s) =>
        (ts.isFunctionDeclaration(s) && s.name?.text === name) ||
        (ts.isVariableStatement(s) && s.declarationList.declarations.some((d) => ts.isIdentifier(d.name) && d.name.text === name))
    )
    if (!node) findings.push(`helper ${name} is on the read-only helper list but is not defined in helpers.ts`)
    else findings.push(...audit(sf, node, { approved: APPROVED_HELPER_CALLS }).map((f) => `${name}: ${f}`))
  }
  return findings
}
