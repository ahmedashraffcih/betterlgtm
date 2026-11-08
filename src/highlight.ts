import refractor from "refractor/core";
import bash from "refractor/lang/bash";
import c from "refractor/lang/c";
import cpp from "refractor/lang/cpp";
import csharp from "refractor/lang/csharp";
import css from "refractor/lang/css";
import docker from "refractor/lang/docker";
import go from "refractor/lang/go";
import java from "refractor/lang/java";
import javascript from "refractor/lang/javascript";
import json from "refractor/lang/json";
import jsx from "refractor/lang/jsx";
import kotlin from "refractor/lang/kotlin";
import markdown from "refractor/lang/markdown";
import markup from "refractor/lang/markup";
import php from "refractor/lang/php";
import python from "refractor/lang/python";
import ruby from "refractor/lang/ruby";
import rust from "refractor/lang/rust";
import scss from "refractor/lang/scss";
import sql from "refractor/lang/sql";
import swift from "refractor/lang/swift";
import toml from "refractor/lang/toml";
import tsx from "refractor/lang/tsx";
import typescript from "refractor/lang/typescript";
import yaml from "refractor/lang/yaml";
import { markEdits, tokenize, type HunkData, type HunkTokens } from "react-diff-view";

for (const lang of [markup, css, javascript, jsx, typescript, tsx, bash, c, cpp, csharp, docker, go, java, json, kotlin, markdown, php, python, ruby, rust, scss, sql, swift, toml, yaml]) {
  refractor.register(lang);
}

const BY_EXT: Record<string, string> = {
  ts: "typescript", mts: "typescript", cts: "typescript", tsx: "tsx", js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "jsx",
  py: "python", go: "go", rs: "rust", java: "java", kt: "kotlin", kts: "kotlin", rb: "ruby", php: "php", cs: "csharp", swift: "swift",
  c: "c", h: "c", cc: "cpp", cpp: "cpp", hpp: "cpp", css: "css", scss: "scss", json: "json", yml: "yaml", yaml: "yaml", toml: "toml",
  md: "markdown", sql: "sql", sh: "bash", bash: "bash", zsh: "bash", html: "markup", xml: "markup", svg: "markup", vue: "markup",
};

export function languageOf(path: string): string | null {
  const name = path.split("/").pop() ?? "";
  if (/^Dockerfile/.test(name)) return "docker";
  return BY_EXT[name.split(".").pop()?.toLowerCase() ?? ""] ?? null;
}

/** Syntax tokens plus word-level edit marks for a file's hunks; null when the language isn't known or it fails. */
export function highlightHunks(hunks: HunkData[], path: string): HunkTokens | null {
  const language = languageOf(path);
  try {
    return tokenize(hunks, {
      highlight: !!language,
      refractor: refractor as never,
      language: language ?? "text",
      enhancers: [markEdits(hunks, { type: "block" })],
    });
  } catch {
    return null;
  }
}
