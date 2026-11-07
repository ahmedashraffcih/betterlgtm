import {
  Bug, CircleCheck, CircleExclamationPoint, CircleX, Contrast, Database, FileBraces, FileCheck, FileCode, FileText,
  FileX, FlaskConical, Info, OctagonExclamationPoint, Shield, SlidersHorizontal, TriangleExclamationPoint, Wrench,
  type LucideIcon,
} from "lucide-react";
import type { Severity, Verdict } from "./analysis";

export const SEVERITY: Record<Severity, { icon: LucideIcon; tone: string; label: string }> = {
  critical: { icon: OctagonExclamationPoint, tone: "tone-crit", label: "Critical" },
  high: { icon: TriangleExclamationPoint, tone: "tone-high", label: "High" },
  medium: { icon: CircleExclamationPoint, tone: "tone-muted", label: "Medium" },
  low: { icon: Info, tone: "tone-muted", label: "Low" },
};

export const VERDICT: Record<Verdict, { icon: LucideIcon; tone: string; label: string }> = {
  implemented: { icon: CircleCheck, tone: "tone-ok", label: "Implemented" },
  partial: { icon: Contrast, tone: "tone-high", label: "Partly implemented" },
  contradicted: { icon: CircleX, tone: "tone-crit", label: "Contradicted by the code" },
  missing: { icon: FileX, tone: "tone-crit", label: "Not in this PR" },
};

const CATEGORY: Record<string, LucideIcon> = {
  correctness: Bug,
  security: Shield,
  "behavior change": SlidersHorizontal,
  tests: FlaskConical,
  "data handling": Database,
};

export function categoryIcon(category: string): LucideIcon {
  return CATEGORY[category.toLowerCase()] ?? Wrench;
}

export function fileIcon(path: string): LucideIcon {
  if (path.endsWith(".md")) return FileText;
  if (path.endsWith(".json")) return FileBraces;
  if (/\.(test|spec)\./.test(path)) return FileCheck;
  return FileCode;
}
