/**
 * A small OpenSCAD highlighter for the read-only code view. Editor libraries
 * don't know OpenSCAD, and colouring the code needs a tokenizer, not a parser.
 */

export type TokenType =
  | "comment"
  | "string"
  | "number"
  | "keyword"
  | "builtin"
  | "special"
  | "definition"
  | "path"
  | "operator"
  | "text";

export interface Token {
  type: TokenType;
  text: string;
}

const KEYWORDS = new Set([
  "module", "function", "if", "else", "for", "intersection_for", "let", "each", "assert", "echo",
  "include", "use", "true", "false", "undef",
]);

const BUILTINS = new Set([
  // Primitives
  "cube", "sphere", "cylinder", "polyhedron", "square", "circle", "polygon", "text", "import", "surface",
  // Transformations, booleans and extrusions
  "translate", "rotate", "scale", "resize", "mirror", "multmatrix", "color", "offset", "hull", "minkowski",
  "union", "difference", "intersection", "render", "projection", "linear_extrude", "rotate_extrude", "children",
  // Functions and constants
  "abs", "sign", "sin", "cos", "tan", "asin", "acos", "atan", "atan2", "floor", "round", "ceil", "ln", "log",
  "pow", "sqrt", "exp", "min", "max", "norm", "cross", "len", "concat", "lookup", "str", "chr", "ord", "search",
  "rands", "version", "version_num", "is_undef", "is_bool", "is_num", "is_string", "is_list", "is_function", "PI",
]);

const COMMENT = /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/y;
const STRING = /"(?:[^"\\\n]|\\.)*"?/y; // an unterminated string ends with its line
const PATH = /<[^>\n]*>?/y;
const NUMBER = /(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/y;
const SPECIAL = /\$\w+/y;
const WORD = /[A-Za-z_]\w*/y;
const OPERATOR = /[-+*/%^!<>=&|?:#]+/y; // includes the # % ! * modifiers
const SPACE = /\s+/y;

function matchAt(re: RegExp, code: string, at: number): string | undefined {
  re.lastIndex = at;
  return re.exec(code)?.[0];
}

/** Splits OpenSCAD code into tokens; adjacent plain text is merged. */
export function tokenize(code: string): Token[] {
  const tokens: Token[] = [];
  // The last token that is not whitespace or a comment: `include` before a <path>, `module` before a name.
  let previous: Token | undefined;
  const push = (type: TokenType, text: string) => {
    const last = tokens.at(-1);
    if (type === "text" && last?.type === "text") last.text += text;
    else tokens.push({ type, text });
  };

  let at = 0;
  while (at < code.length) {
    let text: string | undefined;
    let type: TokenType = "text";
    if ((text = matchAt(COMMENT, code, at))) type = "comment";
    else if ((text = matchAt(STRING, code, at))) type = "string";
    else if ((previous?.text === "include" || previous?.text === "use") && (text = matchAt(PATH, code, at))) type = "path";
    else if ((text = matchAt(NUMBER, code, at))) type = "number";
    else if ((text = matchAt(SPECIAL, code, at))) type = "special";
    else if ((text = matchAt(WORD, code, at))) {
      if (KEYWORDS.has(text)) type = "keyword";
      else if (previous?.text === "module" || previous?.text === "function") type = "definition";
      else if (BUILTINS.has(text)) type = "builtin";
    } else if ((text = matchAt(OPERATOR, code, at))) type = "operator";
    else text = matchAt(SPACE, code, at) ?? code[at]; // whitespace, or one punctuation character

    push(type, text);
    if (type !== "comment" && text.trim()) previous = { type, text };
    at += text.length;
  }
  return tokens;
}

/** Tokens per line, for a view with line numbers. A trailing newline adds no empty last line. */
export function highlightLines(code: string): Token[][] {
  const lines: Token[][] = [[]];
  for (const token of tokenize(code.replace(/\r\n?/g, "\n"))) {
    token.text.split("\n").forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part) lines[lines.length - 1].push({ type: token.type, text: part });
    });
  }
  if (lines.length > 1 && lines[lines.length - 1].length === 0) lines.pop();
  return lines;
}
