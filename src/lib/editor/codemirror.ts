/** CodeMirror 6 setup: dark theme + language detected from the file name. */

import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, indentOnInput, LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";

/** Text extensions the editor will open (others are downloaded instead). */
const EDITABLE_EXTENSIONS = new Set([
  "sh", "bash", "zsh", "py", "js", "ts", "tsx", "json", "yaml", "yml", "toml",
  "ini", "conf", "cfg", "txt", "md", "log", "service", "xml", "html", "css",
  "rs", "c", "h", "cpp", "java", "go", "php", "rb", "sql", "env", "properties",
]);

const EDITABLE_NAMES = new Set([
  "dockerfile", "makefile", ".env", ".bashrc", ".profile", "nginx.conf", "hosts",
]);

export function isEditableFile(name: string): boolean {
  const lower = name.toLowerCase();
  if (EDITABLE_NAMES.has(lower)) {
    return true;
  }
  const dot = lower.lastIndexOf(".");
  if (dot <= 0) {
    return false;
  }
  return EDITABLE_EXTENSIONS.has(lower.slice(dot + 1));
}

export async function createEditor(
  parent: HTMLElement,
  initialText: string,
  fileName: string,
  onChange: () => void,
): Promise<EditorView> {
  const description = LanguageDescription.matchFilename(languages, fileName);
  const language = description ? await description.load() : null;

  const extensions = [
    lineNumbers(),
    highlightActiveLineGutter(),
    history(),
    drawSelection(),
    highlightActiveLine(),
    indentOnInput(),
    bracketMatching(),
    keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
    oneDark,
    EditorState.tabSize.of(4),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChange();
      }
    }),
    EditorView.theme({
      "&": { height: "100%", fontSize: "12.5px" },
      ".cm-scroller": { fontFamily: "var(--font-mono)", overflow: "auto" },
      ".cm-content": { caretColor: "#4ade80" },
    }),
  ];
  if (language !== null) {
    extensions.push(language);
  }

  const state = EditorState.create({ doc: initialText, extensions });
  return new EditorView({ state, parent });
}
