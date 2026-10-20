// SPDX-License-Identifier: GPL-3.0-or-later
// The Bleep Script subset checker (doc/specs/bleep-script.md, section 3.4). It runs in the transform, on the syntax tree, before the
// compiler sees the code, and does two jobs:
//
//   1. Whole file (user code): nothing that adds a host import or reaches memory directly: `declare function`, `@external`,
//      `@global`, `load`/`store`/`memory`/`changetype`/`unchecked`/`unreachable`/`abort`/`__x`, and imports other than bleep/*.
//   2. Real-time code (what the audio thread runs: block(), sample(), reset(), the @on handlers, and everything they call): no loop
//      without a constant bound, no recursion, no allocation (`new`, array and object literals, template literals, string
//      concatenation, closures, methods that grow or copy), no exceptions, no call to something unknown.
//
// And it estimates the cost of one chunk in abstract operations (one per node, loops multiplied by their bound, calls by the callee),
// so a module over budget can be refused at compile time. The estimate is a bound on the work, not a time; 1 op is about a nanosecond
// on the engine's Wasmtime host (the Gains channel: 25 ops, 24 ns per sample).
//
// The Bleep library sources (src/bleep/) are trusted: they are read for their costs, and not held to the rules.

import { ASTBuilder, NodeKind, LiteralKind, Token } from "assemblyscript";

export const CHUNK = 32;
export const BUDGET = { warn: 60000, error: 400000 };   // ops per chunk
const MAX_LOOP = 4096;
const ASSUMED_CONSTANT = 64;      // the value of a `declare const` the build does not set (a count such as CHANNELS)
const DECLARE = 32768;            // CommonFlags.Declare

const BUILTINS = new Set(["abs", "max", "min", "sqrt", "floor", "ceil", "trunc", "nearest", "copysign", "isNaN", "isFinite", "clz", "ctz", "popcnt", "rotl", "rotr", "sizeof"]);
const MATH = new Set(["Math", "Mathf", "NativeMath", "NativeMathf"]);
const ALLOCATING_METHODS = new Set(["push", "pop", "shift", "unshift", "splice", "concat", "slice", "map", "filter", "reduce", "reduceRight", "forEach", "split", "join",
  "toString", "substring", "substr", "padStart", "padEnd", "repeat", "trim", "toUpperCase", "toLowerCase", "sort", "reverse", "fill", "indexOf", "includes"]);
const BANNED_IDENTIFIERS = new Set(["load", "store", "memory", "changetype", "unchecked", "unreachable", "abort", "trace", "seed", "unsafe", "call_indirect"]);
const BANNED_DECORATORS = new Set(["external", "global", "unsafe"]);

const text = (node) => ASTBuilder.build(node);
const integerOf = (node) => {   // the value of an integer literal or a negated one, else null
  if (!node) return null;
  if (node.kind === NodeKind.Literal && node.literalKind === LiteralKind.Integer) return Number(text(node));
  if (node.kind === NodeKind.UnaryPrefix && node.operator === Token.Minus) { const v = integerOf(node.operand); return v === null ? null : -v; }
  if (node.kind === NodeKind.Parenthesized) return integerOf(node.expression);
  return null;
};

/// One function or method of a source: where it is, and whether it is held to the rules.
class Fn {
  constructor(node, source, owner, trusted) { Object.assign(this, { node, source, owner, trusted, name: node.name ? node.name.text : "", cost: null, state: 0 }); }
}

export class Subset {
  /// sources: the parsed sources (user and library); constants: { NAME: value } for `declare const`s the build sets.
  constructor(sources, { constants = {} } = {}) {
    this.problems = [];
    this.constants = constants;
    this.fns = [];                // every function and method
    this.byName = new Map();      // name -> [Fn]   (methods and top-level functions)
    this.topFns = new Map();      // name -> Fn
    this.consts = new Map();      // top-level const name -> number
    this.fieldTypes = new Map();     // class name -> Map(field name -> class name of its type)
    this.libraryNames = new Set();   // names imported from bleep/*
    for (const [name, value] of Object.entries(constants)) this.consts.set(name, value);   // the module's settings
    this.user = [];
    for (const source of sources) {
      const path = source.normalizedPath;
      if (path.startsWith("~lib/")) continue;
      const trusted = /(^|\/)bleep\/[^/]+$/.test(path);
      if (!trusted) this.user.push(source);
      this.#collect(source, trusted);
    }
  }

  // ---- problems ---------------------------------------------------------------------------------------------------------------------------
  line(source, node) { try { return source.text.slice(0, node.range.start).split("\n").length; } catch { return 1; } }
  error(source, node, message) {
    const line = this.line(source, node);
    if (!this.problems.some((p) => p.line === line && p.message === message && p.file === source.normalizedPath))
      this.problems.push({ severity: "error", message, line, file: source.normalizedPath });
  }

  // ---- tables ------------------------------------------------------------------------------------------------------------------------------
  #collect(source, trusted) {
    const add = (fn) => {
      this.fns.push(fn);
      if (fn.name) { if (!this.byName.has(fn.name)) this.byName.set(fn.name, []); this.byName.get(fn.name).push(fn); }
    };
    for (const st of source.statements) {
      if (st.kind === NodeKind.FunctionDeclaration && st.body) { const fn = new Fn(st, source, null, trusted); add(fn); if (fn.name) this.topFns.set(fn.name, fn); }
      else if (st.kind === NodeKind.ClassDeclaration) {
        const fields = new Map();
        this.fieldTypes.set(st.name.text, fields);
        for (const m of st.members || []) {
          if (m.kind === NodeKind.MethodDeclaration && m.body) add(new Fn(m, source, st.name.text, trusted));
          else if (m.kind === NodeKind.FieldDeclaration && m.type && m.name) {
            const t = text(m.type), element = /^(?:StaticArray|Array)<\s*([A-Za-z_][A-Za-z0-9_]*)\s*>/.exec(t);
            fields.set(m.name.text, t.replace(/<.*$/, "").replace(/\|.*$/, "").trim());
            if (element) fields.set(`${m.name.text}[]`, element[1]);   // the class of an array's elements: this.lows[i].next()
          }
        }
      } else if (st.kind === NodeKind.Variable) {
        for (const d of st.declarations || []) {
          const v = integerOf(d.initializer);
          if (v !== null) this.consts.set(d.name.text, v);
          else if (d.flags & DECLARE) this.consts.set(d.name.text, this.constants[d.name.text] ?? ASSUMED_CONSTANT);
        }
      } else if (st.kind === NodeKind.Import && !trusted) {
        const from = st.path ? st.path.value : "";
        if (!/^(\.\/|\.\.\/)?(\.\/)?bleep\//.test(from)) this.error(source, st, `only bleep/ libraries can be imported, not "${from}"`);
        else for (const d of st.declarations || []) if (d.name) this.libraryNames.add(d.name.text);
      }
    }
  }

  // ---- the whole file: no host imports, no raw memory --------------------------------------------------------------------------------
  checkFile(source) {
    const seen = new WeakSet();
    const walk = (n) => {
      if (!n || typeof n !== "object" || seen.has(n)) return;
      if (Array.isArray(n)) { n.forEach(walk); return; }
      if (typeof n.kind !== "number") return;
      seen.add(n);
      if ((n.kind === NodeKind.FunctionDeclaration || n.kind === NodeKind.NamespaceDeclaration) && (n.flags & DECLARE) && n.kind !== NodeKind.Variable)
        this.error(source, n, "`declare` adds a host import to the module, which is not allowed");
      for (const d of n.decorators || []) if (d.name && BANNED_DECORATORS.has(d.name.text)) this.error(source, d, `@${d.name.text} is not allowed`);
      if (n.kind === NodeKind.Identifier && n.text && (BANNED_IDENTIFIERS.has(n.text) || /^__/.test(n.text))) this.error(source, n, `'${n.text}' is not allowed: it reaches the module's memory or stops it`);
      for (const k of Object.keys(n)) if (k !== "range" && k !== "source" && k !== "parent") walk(n[k]);
    };
    walk(source.statements);
  }

  // ---- real-time code: rules and cost ---------------------------------------------------------------------------------------------------
  /// The cost of one call of a function, in ops; reports the rule breaches in it (unless it is library code).
  costOfFn(fn, stack = []) {
    if (fn.cost !== null) return fn.cost;
    if (stack.includes(fn)) {
      if (!fn.trusted) this.error(fn.source, fn.node, `'${fn.name}' calls itself: recursion is not allowed in real-time code`);
      return 0;
    }
    stack.push(fn);
    const ctx = { fn, stack, trusted: fn.trusted };
    let c = fn.node.body ? this.#node(fn.node.body, ctx) : 0;
    stack.pop();
    fn.cost = c + 4;
    return fn.cost;
  }

  #sum(list, ctx) { let c = 0; for (const x of list || []) c += this.#node(x, ctx); return c; }

  #bound(node, ctx) {
    // for (let i = A; i < B; i++) with A and B constants: the number of rounds, else null
    const init = node.initializer, cond = node.condition, inc = node.incrementor;
    const decl = init && init.kind === NodeKind.Variable && init.declarations && init.declarations[0];
    if (!decl || !cond || cond.kind !== NodeKind.Binary || !inc) return null;
    const name = decl.name.text;
    const start = integerOf(decl.initializer);
    const value = (n) => { const v = integerOf(n); if (v !== null) return v; return n && n.kind === NodeKind.Identifier && this.consts.has(n.text) ? this.consts.get(n.text) : null; };
    if (start === null || cond.left.kind !== NodeKind.Identifier || cond.left.text !== name) return null;
    const limit = value(cond.right);
    if (limit === null) return null;
    let step = null;
    if (inc.kind === NodeKind.UnaryPostfix || inc.kind === NodeKind.UnaryPrefix) step = inc.operator === Token.Plus_Plus ? 1 : inc.operator === Token.Minus_Minus ? -1 : null;
    else if (inc.kind === NodeKind.Binary && inc.left.kind === NodeKind.Identifier && inc.left.text === name) {
      const k = integerOf(inc.right);
      step = k === null ? null : inc.operator === Token.Plus_Equals ? k : inc.operator === Token.Minus_Equals ? -k : null;
    }
    if (!step) return null;
    const op = cond.operator;
    let span;
    if (step > 0 && (op === Token.LessThan || op === Token.LessThan_Equals)) span = limit - start + (op === Token.LessThan_Equals ? 1 : 0);
    else if (step < 0 && (op === Token.GreaterThan || op === Token.GreaterThan_Equals)) span = start - limit + (op === Token.GreaterThan_Equals ? 1 : 0);
    else return null;
    return Math.max(0, Math.ceil(span / Math.abs(step)));
  }

  #call(node, ctx) {
    const callee = node.expression;
    let cost = 4 + this.#sum(node.args, ctx);
    const unknown = (what) => { if (!ctx.trusted) this.error(ctx.fn.source, node, `call to unknown ${what}: only your own methods and functions, Math, and the bleep/ library can be called in real-time code`); };
    const viaFns = (fns) => { let m = 0; for (const f of fns) m = Math.max(m, this.costOfFn(f, ctx.stack)); return m; };
    if (callee.kind === NodeKind.Identifier) {
      const name = callee.text;
      if (BUILTINS.has(name)) return cost + 2;
      if (this.topFns.has(name)) return cost + viaFns([this.topFns.get(name)]);
      if (this.libraryNames.has(name)) return cost + 20;
      unknown(`function '${name}'`);
      return cost;
    }
    if (callee.kind === NodeKind.PropertyAccess) {
      const name = callee.property.text, target = callee.expression;
      if (target.kind === NodeKind.Identifier && MATH.has(target.text)) return cost + 25;
      // the receiver's class when the syntax says it: this.m(), this.field.m(); else every method of that name
      let owner = null;
      if (target.kind === NodeKind.This) owner = ctx.fn.owner;
      else if (target.kind === NodeKind.ElementAccess && target.expression.kind === NodeKind.PropertyAccess && target.expression.expression.kind === NodeKind.This && ctx.fn.owner)
        owner = (this.fieldTypes.get(ctx.fn.owner) || new Map()).get(`${target.expression.property.text}[]`) || null;
      else if (target.kind === NodeKind.PropertyAccess && target.expression.kind === NodeKind.This && ctx.fn.owner) owner = (this.fieldTypes.get(ctx.fn.owner) || new Map()).get(target.property.text) || null;
      const candidates = (this.byName.get(name) || []).filter((f) => !owner || f.owner === owner);
      if (ALLOCATING_METHODS.has(name) && !(owner && candidates.length)) {   // a method of that name on a class we can see is the library's or the user's own
        if (!ctx.trusted) this.error(ctx.fn.source, node, `'${name}' may allocate or copy, which real-time code must not do`);
        return cost;
      }
      if (candidates.length) return cost + viaFns(candidates);
      unknown(`method '${name}'`);
      return cost;
    }
    unknown("expression");
    return cost;
  }

  #node(n, ctx) {
    if (!n || typeof n !== "object") return 0;
    if (Array.isArray(n)) return this.#sum(n, ctx);
    if (typeof n.kind !== "number") return 0;
    const bad = (msg) => { if (!ctx.trusted) this.error(ctx.fn.source, n, msg); };
    switch (n.kind) {
      case NodeKind.While: case NodeKind.Do:
        bad("a while loop has no bound: use for (let i = 0; i < N; i++) with a constant N");
        return this.#node(n.condition, ctx) + this.#node(n.body, ctx);
      case NodeKind.ForOf:
        bad("for...of has no constant bound: use for (let i = 0; i < N; i++) with a constant N");
        return this.#node(n.body, ctx);
      case NodeKind.For: {
        const rounds = this.#bound(n, ctx);
        if (rounds === null) { bad("the loop bound must be constant: for (let i = 0; i < N; i++) with a number or a top-level const N, and i++ (or +=, -= a number)"); return this.#node(n.body, ctx); }
        if (rounds > MAX_LOOP) bad(`the loop runs ${rounds} times; at most ${MAX_LOOP} are allowed`);
        return 2 + Math.min(rounds, MAX_LOOP) * (this.#node(n.body, ctx) + 3);
      }
      case NodeKind.New:
        if (!(ctx.fn.node.name && ctx.fn.node.name.kind === NodeKind.Constructor)) bad("`new` allocates: create objects in the constructor");
        return 20;
      case NodeKind.Literal:
        if (n.literalKind === LiteralKind.Array || n.literalKind === LiteralKind.Object) bad("array and object literals allocate: create them in the constructor");
        else if (n.literalKind === LiteralKind.Template) bad("template strings allocate");
        else if (n.literalKind === LiteralKind.RegExp) bad("regular expressions are not allowed");
        return 1 + (n.elementExpressions ? this.#sum(n.elementExpressions, ctx) : 0);
      case NodeKind.Function: case NodeKind.Class:
        bad("closures and class expressions are not allowed in real-time code");
        return 1;
      case NodeKind.Try: case NodeKind.Throw:
        bad("exceptions are not allowed in real-time code");
        return 1;
      case NodeKind.Binary:
        if (n.operator === Token.Plus && ((n.left.kind === NodeKind.Literal && n.left.literalKind === LiteralKind.String) || (n.right.kind === NodeKind.Literal && n.right.literalKind === LiteralKind.String)))
          bad("string concatenation allocates");
        return 1 + this.#node(n.left, ctx) + this.#node(n.right, ctx);
      case NodeKind.Call: return this.#call(n, ctx);
      case NodeKind.If: {
        const t = this.#node(n.ifTrue, ctx), f = n.ifFalse ? this.#node(n.ifFalse, ctx) : 0;
        return 1 + this.#node(n.condition, ctx) + Math.max(t, f);
      }
      case NodeKind.Ternary: return 1 + this.#node(n.condition, ctx) + Math.max(this.#node(n.ifThen, ctx), this.#node(n.ifElse, ctx));
      case NodeKind.Switch: {
        let worst = 0;
        for (const c of n.cases || []) worst = Math.max(worst, this.#sum(c.statements, ctx));
        return 1 + this.#node(n.condition, ctx) + worst;
      }
      default: {
        let c = (n.kind === NodeKind.Identifier || n.kind === NodeKind.This || n.kind === NodeKind.True || n.kind === NodeKind.False) ? 1 : 0;
        for (const k of Object.keys(n)) {
          if (k === "range" || k === "source" || k === "parent" || k === "decorators" || k === "type" || k === "signature" || k === "typeName" || k === "typeArguments") continue;
          const v = n[k];
          if (v && typeof v === "object") c += this.#node(v, ctx);
        }
        return c;
      }
    }
  }

  /// A module class's real-time cost: { block, sample, handlers, ops } per chunk of 32 samples. `roots`: { name: Fn } of its methods.
  moduleCost(className) {
    const get = (name) => this.fns.find((f) => f.owner === className && f.name === name && !f.trusted);
    const cost = (name) => { const f = get(name); return f ? this.costOfFn(f) : 0; };
    const handlers = this.fns.filter((f) => f.owner === className && !f.trusted && f.handlerWeight).map((f) => f.handlerWeight * this.costOfFn(f));
    const block = cost("block"), sample = cost("sample");
    return { block, sample, handlers: handlers.reduce((a, b) => a + b, 0), ops: block + CHUNK * sample + handlers.reduce((a, b) => a + b, 0) };
  }

  /// Marks a method of a class as an event handler, run `weight` times per chunk at most (64 note events, 32 edges), so its cost counts.
  markHandler(className, name, weight) { const f = this.fns.find((x) => x.owner === className && x.name === name && !x.trusted); if (f) f.handlerWeight = weight; }
}
