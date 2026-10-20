// SPDX-License-Identifier: GPL-3.0-or-later
// The Bleep Script code editor: CodeMirror 6 (MIT) with TypeScript highlighting, line numbers, bracket matching, history, completion for
// the Bleep decorators and library, and the compiler's problems as markers. Bundled (npm run bundle) to dist/bleep-script-editor.js.
//
//   const editor = createEditor({ parent, doc, onRun })
//   editor.getValue() / setValue(text) / setProblems([{ line, column, severity, message }]) / jump(line) / focus() / destroy()
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, placeholder } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, indentOnInput, syntaxHighlighting, HighlightStyle, foldGutter, foldKeymap } from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, snippetCompletion } from "@codemirror/autocomplete";
import { setDiagnostics, lintGutter } from "@codemirror/lint";
import { tags as t } from "@lezer/highlight";

// ---- completion: decorators, lifecycle methods and library imports, as snippets ------------------------------------------------------
const snippet = (label, template, detail) => snippetCompletion(template, { label, detail, type: "keyword", boost: 1 });
const SNIPPETS = [
  snippet("@module", '@module({\n  name: "${Name}",\n  category: "Utility/Script",\n})\nexport class ${Name} {\n  ${}\n  constructor(sampleRate: f64) {}\n}', "a module class"),
  snippet("@input", '@input({ name: "${In}", type: "${audio}" }) ${x}: f32 = 0;', "an input jack"),
  snippet("@input notes", '@input({ name: "${Notes}", type: "notes" }) ${notes}!: NoteStream;', "a notes input"),
  snippet("@output", '@output({ name: "${Out}", type: "${audio}" }) ${out}: f32 = 0;', "an output jack"),
  snippet("@param", '@param({ name: "${Gain}", min: ${0}, max: ${1}, init: ${0.5} }) ${gain}: f32 = ${0.5};', "a knob"),
  snippet("@param exp", '@param({ name: "${Time}", min: ${0.01}, max: ${4}, init: ${0.5}, map: "exp", unit: "s" }) ${time}: f32 = ${0.5};', "an exponential knob"),
  snippet("@param bool", '@param({ name: "${Mute}" }) ${mute}: bool = false;', "a toggle"),
  snippet("@param choice", '@param({ name: "${Shape}", choices: ["${Sine}", "${Triangle}"] }) ${shape}: i32 = 0;', "a choice"),
  snippet("@param count", '@param({ name: "${Gain}", min: ${0}, max: ${1}, init: ${1}, count: ${CHANNELS}, group: "Ch {n}" }) ${gain}!: StaticArray<f32>;', "one knob per channel"),
  snippet("@probe", '@probe ${level}: f32 = 0;', "a value for the view"),
  snippet("@transport", '@transport ${tempo}(bpm: f64, ppq: f64, playing: bool): void {\n  ${}\n}', "the tempo and position, before every block"),
  snippet("@button", '@button({ name: "${Reset}" }) ${reset}(): void {\n  ${}\n}', "a button"),
  snippet("@on notes", '@on("${notes}") ${route}(n: NoteEvent): void {\n  ${}\n}', "a note handler"),
  snippet("@on rising", '@on("${cc}", { rising: ${0.5} }) ${open}(): void {\n  ${}\n}', "an edge handler"),
  snippet("block", "block(): void {\n  ${}\n}", "once per 32 samples"),
  snippet("sample", "sample(): void {\n  ${}\n}", "once per sample"),
  snippet("reset", "reset(): void {\n  ${}\n}", "clear state"),
  snippet("for loop", "for (let ${i} = 0; ${i} < ${CHANNELS}; ${i}++) {\n  ${}\n}", "a bounded loop"),
  snippet("import dsp", 'import { ${Smoother}, PeakHold, Biquad, dbToLin } from "./bleep/dsp";', "the library"),
  snippet("import notes", 'import { NoteEvent, NoteStream } from "./bleep/notes";', "notes"),
];
const WORDS = ["f32", "f64", "i32", "bool", "StaticArray", "Smoother", "PeakHold", "Biquad", "dbToLin", "NoteEvent", "NoteStream", "Math", "abs", "min", "max", "sqrt", "floor",
  "setLowShelf", "setHighShelf", "setPeaking", "setLowpass", "transpose", "isOn", "isOff", "push", "clear", "offsetAt", "snap", "next"].map((label) => ({ label, type: "variable" }));

function complete(context) {
  const word = context.matchBefore(/[@\w]+/);
  if (!word || (word.from === word.to && !context.explicit)) return null;
  return { from: word.from, options: [...SNIPPETS, ...WORDS], validFor: /^[@\w]*$/ };
}

// ---- looks: the board's colours -------------------------------------------------------------------------------------------------------------------
const theme = EditorView.theme({
  "&": { height: "100%", color: "var(--text)", backgroundColor: "var(--canvas)", fontSize: "12px" },
  ".cm-scroller": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", lineHeight: "1.5" },
  ".cm-content": { caretColor: "var(--text)", padding: "6px 0" },
  ".cm-cursor": { borderLeftColor: "var(--text)" },
  "&.cm-focused": { outline: "2px solid var(--sel)", outlineOffset: "-2px" },
  ".cm-gutters": { backgroundColor: "var(--canvas)", color: "var(--muted)", border: "none", borderRight: "1px solid var(--line)" },
  ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--panel-3) 55%, transparent)" },
  ".cm-activeLineGutter": { backgroundColor: "color-mix(in srgb, var(--panel-3) 55%, transparent)", color: "var(--text)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: "color-mix(in srgb, var(--sel) 35%, transparent)" },
  ".cm-matchingBracket": { backgroundColor: "color-mix(in srgb, var(--accent) 30%, transparent)", outline: "none" },
  ".cm-tooltip": { backgroundColor: "var(--panel)", border: "1px solid var(--line)", color: "var(--text)", borderRadius: "6px" },
  ".cm-tooltip-autocomplete ul li[aria-selected]": { backgroundColor: "var(--panel-3)", color: "var(--text)" },
  ".cm-completionDetail": { color: "var(--muted)", marginLeft: "8px" },
  ".cm-diagnostic": { padding: "3px 6px" },
  ".cm-lintRange-error": { backgroundImage: "none", textDecoration: "underline wavy var(--warn)" },
  ".cm-lintRange-warning": { backgroundImage: "none", textDecoration: "underline wavy var(--mod)" },
  ".cm-gutter-lint .cm-gutterElement": { color: "var(--warn)" },
  ".cm-placeholder": { color: "var(--muted)" },
});
const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.controlKeyword, t.definitionKeyword], color: "#c4b5fd" },
  { tag: [t.typeName, t.className, t.namespace], color: "#7dd3fc" },
  { tag: [t.string, t.special(t.string)], color: "#86efac" },
  { tag: [t.number, t.bool, t.null], color: "#fcd34d" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--muted)", fontStyle: "italic" },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.function(t.variableName))], color: "#fda4af" },
  { tag: [t.meta, t.annotation], color: "#f9a8d4" },
  { tag: [t.operator, t.punctuation], color: "var(--muted)" },
]);

export function createEditor({ parent, doc = "", onRun = () => {}, onChange = () => {} }) {
  const run = () => { onRun(); return true; };
  const state = EditorState.create({
    doc,
    extensions: [
      lineNumbers(), foldGutter(), highlightActiveLineGutter(), lintGutter(), history(), drawSelection(), indentOnInput(), bracketMatching(), closeBrackets(),
      highlightActiveLine(), EditorState.tabSize.of(2), placeholder("Write a module: type @module and press Ctrl+Space"),
      autocompletion({ override: [complete] }),
      javascript({ typescript: true }),
      syntaxHighlighting(highlight),
      theme,
      keymap.of([{ key: "Mod-Enter", run }, { key: "Ctrl-Enter", run }, ...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...foldKeymap, ...completionKeymap, indentWithTab]),
      EditorView.updateListener.of((u) => { if (u.docChanged) onChange(); }),
      EditorView.contentAttributes.of({ "aria-label": "Source code", spellcheck: "false", autocapitalize: "off", autocomplete: "off" }),
    ],
  });
  const view = new EditorView({ state, parent });
  // typing is for the editor: not the board's shortcuts or the computer keyboard's notes
  for (const type of ["keydown", "keyup", "keypress"]) view.dom.addEventListener(type, (e) => e.stopPropagation());

  const offsetOf = (line, column) => {
    const l = view.state.doc.line(Math.max(1, Math.min(view.state.doc.lines, line)));
    return { from: Math.min(l.to, l.from + Math.max(0, (column || 1) - 1)), line: l };
  };
  return {
    view,
    getValue: () => view.state.doc.toString(),
    setValue(text) { view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor: 0 } }); },
    /// problems: [{ line, column, severity: "error" | "warning", message }]; those without a line are not shown here.
    setProblems(problems) {
      const diagnostics = problems.filter((p) => p.line).map((p) => {
        const { from, line } = offsetOf(p.line, p.column);
        const rest = line.text.slice(from - line.from);
        const word = /^[\w$@]+/.exec(rest);
        const to = from + (word ? word[0].length : Math.max(1, rest.length));
        return { from, to: Math.max(from + 1, Math.min(line.to, to)), severity: p.severity === "error" ? "error" : "warning", message: p.message };
      });
      view.dispatch(setDiagnostics(view.state, diagnostics));
    },
    jump(lineNumber) {
      const l = view.state.doc.line(Math.max(1, Math.min(view.state.doc.lines, lineNumber)));
      view.dispatch({ selection: { anchor: l.from, head: l.to }, scrollIntoView: true });
      view.focus();
    },
    focus() { view.focus(); },
    destroy() { view.destroy(); },
  };
}
