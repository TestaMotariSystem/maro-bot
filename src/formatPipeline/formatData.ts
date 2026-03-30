// src/formatPipeline/formatData.ts — Format unstructured table data via OpenAI into Timeline / BudgetPlan / Qualifikationsmatrix
import OpenAI from "openai";
import "dotenv/config";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export type FormatDataType = "timeline" | "budgetplan" | "qualifikationsmatrix";

const TIMELINE_SYSTEM = `You are a data-cleaning formatter for construction/project timelines. The user sends raw table data (Excel, CSV, TSV, semicolon-separated). CREATE A CLEAN timeline structure. Never reject data — always produce the best possible output.

MULTI-SHEET INPUT: If the input contains multiple sheets (marked with [Sheet: Name]), focus on the sheet that contains timeline/Gantt/schedule data. Ignore sheets with project descriptions, budgets, or other non-timeline data.

Input formats you MUST handle:
- Gantt/MS Project exports: "Name;Dauer;Anfang;Ende;Vorgänger;Nachfolger" (semicolon-separated)
- Excel with columns: task name, start date, end date, duration, KW (calendar week)
- Tables with date headers as columns and X marks in cells
- Any mix of German/English column names (Anfang=start, Ende=end, Dauer=duration, Vorgänger=predecessor)

Behavior:
1. PARSE: Accept semicolons, tabs, commas as delimiters. Detect header row automatically.
2. EXTRACT: For each task/phase/milestone row, extract: name, start date, end date. Skip header rows, summary rows that just repeat sub-task ranges, and empty rows.
3. DATES: Excel serial numbers (e.g. 46048) → convert using 1900 date system. German dates "Mo 26.01.26" → 26.01.2026. Prefer DD.MM.YYYY. If only duration + start given, compute end = start + duration.
4. COLUMNS: Generate WEEKLY date columns (every Monday) from project start to project end. Format: "KW01 (06.01.2026)" or just "DD.MM.YYYY" if no KW info.
5. GRID: For each task row, put "X" in every weekly column that falls within [start, end] range. Milestones (duration=0 or "0 Tage") get "X" only in their exact week.
6. HIERARCHY: Preserve phase/sub-task hierarchy in task names. Use indentation like "  Phase 1 > Design" or keep the original naming.
7. WARNINGS: If end < start, include row but add warning. If dates seem unreasonable, add warning but still include.
8. Only return {"error":"..."} when input is completely empty or not recognizable as any table format.

Output schema (valid JSON only, NO markdown code blocks):
{
  "type": "timeline",
  "columns": ["DD.MM.YYYY", ...],
  "rows": [
    { "task": "Task or milestone name", "values": ["X" or "", ...] }
  ],
  "warnings": ["Optional: issues found"]
}`;

const BUDGETPLAN_SYSTEM = `You are a data-cleaning formatter for construction/project budgets. The user sends raw table data (Excel, CSV, TSV). CREATE A CLEAN budget structure. Never reject data.

MULTI-SHEET INPUT: If the input contains multiple sheets (marked with [Sheet: Name]), focus on the sheet that contains budget/cost/financial data with monthly columns. Ignore sheets with project descriptions, timelines, or other non-budget data.

Input formats you MUST handle:
- Budget tables with: Thema/Posten, "Höhe der Investition", Gesamtinvestition, monthly columns (Januar, Februar... or 01/2025, 02/2025...)
- Tables with Euro amounts (6.000 €, 8,000€, 5000) — strip currency symbols, normalize separators
- Tables with annual totals and monthly breakdowns
- Personnel cost rows with hours (e.g. "960h", "320h") — convert to numeric, add warning about unit
- Rows like "Reserve", "Summe", "Gesamt" — include them

Behavior:
1. PARSE: Accept any delimiter. Detect header row. Handle merged cells / multi-line headers.
2. POSTEN: First text column = item name ("posten"). Keep original German names.
3. COLUMNS: Monthly periods as "MM/YYYY" (01/2025, 02/2025...). If input has "Januar, Februar..." → convert to "01/YYYY, 02/YYYY...". Infer the year from context. Last column should be "Gesamt" (total).
4. VALUES: All amounts as plain numbers (no strings, no currency symbols). "6.000 €" → 6000. "8,000" → 8000. Empty cells → 0.
5. TOTAL: If a Gesamt/total column exists in input, use it. Otherwise compute sum of monthly values.
6. DISTRIBUTE: If a row has only an annual total but no monthly breakdown, put the total in the "Gesamt" column and 0 for monthly values. Add a warning suggesting the user distribute the amount.
7. WARNINGS: Flag rows where monthly sum ≠ stated total. Flag hour-based values. Flag missing data.
8. Only return {"error":"..."} when input is completely empty.

Output schema (valid JSON only, NO markdown code blocks):
{
  "type": "budgetplan",
  "columns": ["MM/YYYY", ..., "Gesamt"],
  "rows": [
    { "posten": "Item name", "values": [number, ...], "total": number }
  ],
  "warnings": ["Optional: issues found"]
}`;

const QUALIFIKATIONSMATRIX_SYSTEM = `You are a data-cleaning formatter for qualification/skill matrices. The user sends raw table data (Excel, CSV, TSV). CREATE A CLEAN qualification matrix. Never reject data.

MULTI-SHEET INPUT: If the input contains multiple sheets (marked with [Sheet: Name]), focus on the sheet that contains qualification/skill/competency matrix data. Ignore sheets with project descriptions, budgets, or other non-matrix data.

Input formats you MUST handle:
- Table with roles/persons as ROWS and skills/competencies as COLUMNS (most common in German construction)
- Table with skills as ROWS and persons as COLUMNS (alternative layout)
- Checkmarks: ✓ or √ = 50 (Grundkenntnisse), ✓✓ or √√ = 75 (Fortgeschritten), ✓✓✓ or √√√ = 100 (Experte)
- "x" or "X" = 50, "xx" = 75, "xxx" = 100
- "–" or "-" or empty = 0 (no competency)
- Numeric values 1-5 scale → map to 0, 25, 50, 75, 100
- Numeric values already 0-100 → keep as-is
- German headers: Rolle=Role, Planung=Planning, Konstruktion=Construction, Statik=Structural, Elektrik=Electrical, Baupraxis=Site experience, Normen=Standards/Regulations, Projektleitung=Project management

CRITICAL: Detect the correct orientation:
- If first column header is "Rolle" / "Role" / "Person" / "Name" → rows are people/roles, columns are skills
- If first column header is "Skill" / "Kompetenz" / "Fähigkeit" → rows are skills, columns are people
- The OUTPUT must ALWAYS have: columns = skill/competency names, rows = person/role entries with "skill" field = person/role name

Behavior:
1. PARSE: Accept any delimiter. Detect header row. Handle legend rows at the bottom (e.g. "Legende: ✓ = Grundkenntnisse").
2. NORMALIZE: Convert all skill levels to 0-100 scale. Apply the checkmark mapping above.
3. ORIENTATION: Regardless of input orientation, output MUST be: columns = competency areas, rows[].skill = person/role name.
4. WARNINGS: Flag unclear mappings. Note the original scale if converted.
5. Only return {"error":"..."} when input is completely empty.

Output schema (valid JSON only, NO markdown code blocks):
{
  "type": "qualifikationsmatrix",
  "columns": ["Competency1", "Competency2", ...],
  "rows": [
    { "skill": "Person or Role name", "values": [0-100, ...] }
  ],
  "warnings": ["Optional: issues found, scale conversions applied"]
}`;

function getSystemPrompt(dataType: FormatDataType): string {
  switch (dataType) {
    case "timeline":
      return TIMELINE_SYSTEM;
    case "budgetplan":
      return BUDGETPLAN_SYSTEM;
    case "qualifikationsmatrix":
      return QUALIFIKATIONSMATRIX_SYSTEM;
    default:
      return TIMELINE_SYSTEM;
  }
}

function stripMarkdownCodeBlock(raw: string): string {
  const s = (raw || "").trim();
  const m = s.match(/^```(?:json)?\s*([\s\S]*?)```$/);
  if (m) return m[1].trim();
  return s;
}

function parseJsonResponse(raw: string): { json?: object; error?: string; warnings?: string[] } {
  const cleaned = stripMarkdownCodeBlock(raw);
  try {
    const obj = JSON.parse(cleaned);
    if (!obj || typeof obj !== "object") return { error: "Invalid format." };
    const hasValidStructure = Array.isArray((obj as any).columns) && Array.isArray((obj as any).rows);
    const errMsg = (obj as any).error;
    const warnings = Array.isArray((obj as any).warnings) ? (obj as any).warnings : undefined;
    if (errMsg && typeof errMsg === "string" && !hasValidStructure) {
      return { error: errMsg };
    }
    if (hasValidStructure) {
      return { json: obj, warnings };
    }
    return { error: errMsg || "Could not parse formatted data." };
  } catch {
    return { error: "Could not parse formatted data. Please send a clear table (e.g. copy from Excel)." };
  }
}

function validateFormattedJson(obj: any, dataType: FormatDataType): boolean {
  if (!obj || typeof obj !== "object") return false;
  if (obj.type !== dataType) return false;
  if (!Array.isArray(obj.columns) || !Array.isArray(obj.rows)) return false;
  return true;
}

export async function formatTableWithOpenAI(
  rawText: string,
  dataType: FormatDataType
): Promise<{ json?: object; error?: string; warnings?: string[] }> {
  const systemPrompt = getSystemPrompt(dataType);
  const userContent = (rawText || "").trim() || "No data provided.";
  const model = process.env.AI_MODEL || "gpt-4.1-mini";

  try {
    const response = await client.responses.create({
      model,
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      text: { format: { type: "json_object" } },
    });
    const output = response.output_text || "";
    console.log(`formatTableWithOpenAI(${dataType}): response length=${output.length}`);
    const result = parseJsonResponse(output);
    if (result.error) return result;
    if (result.json && !validateFormattedJson(result.json, dataType)) {
      return { error: "Format did not match expected schema. Please check your table and try again." };
    }
    return result;
  } catch (e: any) {
    console.error("formatTableWithOpenAI error:", e);
    return { error: e?.message || "Formatting failed. Please try again." };
  }
}

export const FORMAT_DATA_TYPE_LABELS: Record<FormatDataType, string> = {
  timeline: "Timeline",
  budgetplan: "Budget plan",
  qualifikationsmatrix: "Qualifikationsmatrix",
};

export const FORMAT_SHAREPOINT_PATHS: Record<FormatDataType, string> = {
  timeline: "bot-data/03_TIMELINE/TimelineTable.json",
  budgetplan: "bot-data/04_BUDGET/BudgetPlan.json",
  qualifikationsmatrix: "bot-data/01_PROJECT_STATE/Qualifikationsmatrix.json",
};

/** One-line summary of formatted JSON for preview (e.g. "Columns: 45 dates; Rows: Rohbau, Elektrik, concept, ..."). */
export function formatPreviewSummary(json: any): string {
  if (!json || typeof json !== "object") return "";
  const cols = Array.isArray(json.columns) ? json.columns : [];
  const rows = Array.isArray(json.rows) ? json.rows : [];
  const rowLabels = rows
    .slice(0, 5)
    .map((r: any) => (r.task ?? r.posten ?? r.skill ?? "?")).filter(Boolean);
  const more = rows.length > 5 ? ` +${rows.length - 5} more` : "";
  return `Columns: ${cols.length}${cols.length ? ` (${cols[0]} … ${cols[cols.length - 1]})` : ""}; Rows: ${rowLabels.join(", ")}${more}.`;
}

const APPLY_CORRECTIONS_SYSTEM = `You have a structured JSON document (timeline, budgetplan, or qualifikationsmatrix). The user will provide corrections in natural language (e.g. "Rohbau end date 16.10.2026", "Elektrik end 16.03.2026", "use original start", "update and save"). Your job is to apply those corrections to the JSON and return the complete updated document.

Rules:
- Output only valid JSON in the exact same schema (type, columns, rows). No markdown, no explanation.
- For timeline: If the user gives a new end date (or start date) for a task by name, update that row so the "X" marks span the correct range. Use DD.MM.YYYY. Use the EXACT year the user provides (e.g. 16.03.2026 means year 2026, not 2025). Extend the "columns" array if the new date is outside the current range. "Use original start" or "use origin one" means keep the existing start for that task.
- For budgetplan/qualifikationsmatrix: Update the numbers or values the user specifies.
- Do not add or require "owner" or "owners" — the schema has no owner field.
- If the user's message cannot be interpreted as corrections, return {"error": "Brief message: paste the full table again or reply Yes to save current version."}`;

/**
 * Apply user corrections to an existing formatted JSON (timeline/budgetplan/qualifikationsmatrix).
 * Used when the user has a pending format and sends e.g. "Rohbau end 16.10.2026, Elektrik 16.03.2026, update and save".
 */
export async function applyCorrectionsToFormattedData(
  pendingJson: object,
  userMessage: string,
  dataType: FormatDataType
): Promise<{ json?: object; error?: string }> {
  const model = process.env.AI_MODEL || "gpt-4.1-mini";
  const userContent =
    `Current JSON:\n${JSON.stringify(pendingJson, null, 2)}\n\nUser corrections:\n${(userMessage || "").trim()}`;

  try {
    const response = await client.responses.create({
      model,
      input: [
        { role: "system", content: APPLY_CORRECTIONS_SYSTEM },
        { role: "user", content: userContent },
      ],
    });
    const output = response.output_text || "";
    const result = parseJsonResponse(output);
    if (result.error) return result;
    if (result.json && !validateFormattedJson(result.json, dataType)) {
      return { error: "Corrected format did not match schema. Paste the full table again or reply Yes to save current version." };
    }
    const obj = result.json as any;
    const cleanJson =
      obj.warnings !== undefined ? { type: obj.type, columns: obj.columns, rows: obj.rows } : obj;
    return { json: cleanJson };
  } catch (e: any) {
    console.error("applyCorrectionsToFormattedData error:", e);
    return { error: e?.message || "Could not apply corrections. Paste the full table again or reply Yes to save current version." };
  }
}
