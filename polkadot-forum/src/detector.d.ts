export interface Issue {
  type: string;
  text: string;
  severity?: string;
  suggestion?: string;
}
export interface Result {
  score: number;
  label: string;
  issues: Issue[];
  stats: { wordCount: number; [k: string]: unknown };
  document_classification: string;
  class_probabilities: { human: number; mixed: number; ai: number };
  confidence_category: string;
}
export declare function analyzeText(
  text: string,
  options?: { contextMode?: 'general' | 'technical' },
): Result;
export declare const AIDetector: { analyzeText: typeof analyzeText };
declare const _default: { analyzeText: typeof analyzeText };
export default _default;
