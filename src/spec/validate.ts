import { isNode, LineCounter, parseDocument, type Document } from "yaml";
import { inputErrorResult, type Diagnostic, type DiagnosticIssue } from "./errors.js";
import { specSchema, type Spec } from "./schema.js";

export type ValidationResult =
  | { valid: true; spec: Spec }
  | { valid: false; error: Diagnostic };

function sourceLocation(document: Document, lines: LineCounter, path: DiagnosticIssue["path"]): NonNullable<DiagnosticIssue["location"]> {
  // Missing fields and alias children fall back to the nearest available parent node.
  for (let length = path.length; length >= 0; length--) {
    const node = document.getIn(path.slice(0, length), true);
    if (isNode(node) && node.range) {
      const position = lines.linePos(node.range[0]);
      return { line: position.line, column: position.col };
    }
  }
  return { line: 1, column: 1 };
}

/** Validate YAML text or a parsed spec object without reading files, logging, or loading a device client. */
export function validate(input: unknown): ValidationResult {
  let value: unknown = input;
  let document: Document | undefined;
  let lines: LineCounter | undefined;
  if (typeof input === "string") {
    lines = new LineCounter();
    try {
      document = parseDocument(input, {
        version: "1.2", schema: "core", merge: false, resolveKnownTags: false,
        strict: true, stringKeys: true, uniqueKeys: true,
        lineCounter: lines, prettyErrors: false, logLevel: "error",
      });
      const problems = [...document.errors, ...document.warnings];
      if (problems.length > 0) {
        return {
          valid: false,
          error: {
            code: "INVALID_YAML",
            message: "YAML could not be validated. Correct the issues below.",
            issues: problems.map((problem) => {
              const position = lines!.linePos(problem.pos[0]);
              return { path: [], message: problem.message, location: { line: position.line, column: position.col } };
            }),
          },
        };
      }
      if (document.directives?.yaml.version !== "1.2") {
        return { valid: false, error: { code: "INVALID_YAML", message: "Use YAML 1.2; other YAML versions are unsupported." } };
      }
      value = document.toJS({ maxAliasCount: 100 });
    } catch (error) {
      return {
        valid: false,
        error: {
          code: "INVALID_YAML", message: "YAML could not be converted to a spec.",
          issues: [{ path: [], message: error instanceof Error ? error.message : "Invalid YAML value." }],
        },
      };
    }
  }

  const parsed = specSchema.safeParse(value);
  if (parsed.success) return { valid: true, spec: parsed.data };
  const diagnostic = inputErrorResult(parsed.error).error;
  if (document && lines && diagnostic.issues) {
    for (const issue of diagnostic.issues) issue.location = sourceLocation(document, lines, issue.path);
  }
  return { valid: false, error: diagnostic };
}
