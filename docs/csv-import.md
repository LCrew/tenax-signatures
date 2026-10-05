# CSV import: missing signature details

Specification for a CSV file that fills in people's missing signature details in one go. It is written so you can
hand it, together with the downloaded list, to a person or an AI agent and get back a file that imports cleanly.

**Workflow:** **People › Import CSV › Download missing list** → fill in the blanks (following this document) →
**Choose CSV file**. The console checks the file and shows what would change, row by row. Nothing is saved until you
click **Import**. Values are saved as corrections (like the person page); Entra / AD is never changed.

---

## Instructions for the agent filling in the file

You get `signature-missing-YYYY-MM-DD.csv`: one row per person whose email signature is missing details. Return the
**same file** with the blank cells filled in. Do not add, remove, or reorder rows or columns.

### The task

1. For each row, read `missing` (a space-separated list of field names). Those are the fields to fill.
2. Fill **only** those cells. Cells that already have a value are correct; copy them unchanged (changing them does
   nothing, and the import reports them as "already set, kept").
3. If you can't determine a value with confidence, **leave the cell empty**. An empty cell means "no change". A
   wrong title in hundreds of outgoing emails is worse than a missing one; the person can be fixed later by hand.
4. Return valid CSV in UTF-8 (see [File format](#file-format)), plus a short list of the rows you left blank and why.

### Columns

| Column        | Import?   | Meaning and rules |
|---------------|-----------|-------------------|
| `upn`         | key       | The person's sign-in address, e.g. `janis.berzins@tenaxgrupa.lv`. **Required, never change it.** Matched case-insensitively. (`email` is accepted as the column name too.) |
| `company`     | no        | Which company signature they get: `tenax`, `tenapors`, `tenaxpanel`, `tenaxinstall`, `vareno`. Context only. |
| `missing`     | no        | The fields to fill, e.g. `jobTitleEn mobilePhone`. Context only. |
| `department`  | no        | Department from the directory, if any. Context to help work out a job title. |
| `displayName` | if missing | Full name as it should appear in the signature: `Vārds Uzvārds`, with correct Latvian diacritics (ā č ē ģ ī ķ ļ ņ š ū ž). Max 120 characters. No titles or company name. |
| `jobTitleLv`  | if missing | Job title in Latvian, e.g. `Pārdošanas projektu vadītājs`. Max 160 characters. Sentence case (first letter capital, rest lower case except proper nouns). Use the feminine form when the person is a woman (vadītāja, speciāliste, grāmatvede). |
| `jobTitleEn`  | if missing | Job title in English, e.g. `Sales Project Manager`. Max 160 characters. Title Case. Usually a translation of `jobTitleLv` (see [Translating titles](#translating-job-titles)). |
| `mobilePhone` | if missing | Work mobile number. Digits, spaces, `+`, `(`, `)` and `-` only, 5–40 characters. Preferred form for Latvian numbers: `+371 2X XXX XXX` (8-digit numbers are formatted that way automatically). |
| `noMobile`    | if mobile missing | `yes` when the person has **no** work mobile. Their mobile line is left out of the signature and they stop counting as missing. Leave empty otherwise. Never `yes` together with a `mobilePhone` value. |

Only `displayName`, `jobTitleLv`, `jobTitleEn`, `mobilePhone` and `noMobile` are imported. Columns are matched by
header name (case-insensitive), so their order doesn't matter. Other columns are ignored and listed as "for
reference only". Email can't be filled in here; it always comes from Entra.

### Translating job titles

Most rows will be missing only `jobTitleEn`, because the directory has no English title. Translate `jobTitleLv` the
way the role would be written on an English business card. Don't translate word for word.

| jobTitleLv                         | jobTitleEn                    |
|------------------------------------|-------------------------------|
| Valdes priekšsēdētājs / -tāja      | Chairman of the Board / Chairwoman of the Board |
| Valdes loceklis / -le              | Member of the Board           |
| Izpilddirektors / -e               | Chief Executive Officer       |
| Finanšu direktors / -e             | Chief Financial Officer       |
| Tehniskais direktors / Tehniskā direktore | Technical Director     |
| Pārdošanas vadītājs / -a           | Sales Manager                 |
| Pārdošanas projektu vadītājs / -a  | Sales Project Manager         |
| Projektu vadītājs / -a             | Project Manager               |
| Eksporta vadītājs / -a             | Export Manager                |
| Loģistikas vadītājs / -a           | Logistics Manager             |
| Iepirkumu speciālists / -e         | Procurement Specialist        |
| Kvalitātes speciālists / -e        | Quality Specialist            |
| Galvenais grāmatvedis / Galvenā grāmatvede | Chief Accountant      |
| Grāmatvede / Grāmatvedis           | Accountant                    |
| Biroja administrators / -e         | Office Administrator          |
| Asistents / Asistente              | Assistant                     |
| Inženieris / Inženiere             | Engineer                      |
| Vecākais inženieris                | Senior Engineer               |
| Konstruktors / -e                  | Design Engineer               |
| Ražošanas vadītājs / -a            | Production Manager            |
| Maiņas meistars                    | Shift Supervisor              |
| Noliktavas vadītājs / -a           | Warehouse Manager             |
| Montāžas brigadieris               | Installation Foreman          |
| Personāla vadītājs / -a            | HR Manager                    |
| Mārketinga speciālists / -e        | Marketing Specialist          |
| IT administrators / -e             | IT Administrator              |

Rules:

- English titles are gender-neutral (both `vadītājs` and `vadītāja` → `Manager`).
- Keep the seniority: `vecākais` → `Senior`, `galvenais` → `Chief` / `Head of`, `jaunākais` → `Junior`.
- Keep the area: `Pārdošanas …` → `Sales …`, `Eksporta …` → `Export …`.
- Leave out company names, department codes and notes in brackets unless they're part of the title.
- If `jobTitleLv` is also missing, fill both only when you have a reliable source. Otherwise leave both empty.

### Don't

- Don't invent mobile numbers, names or titles. Leave the cell empty instead.
- Don't use a personal mobile you found publicly; only work numbers you were given.
- Don't put line breaks, tabs or several values in one cell.
- Don't fill `noMobile` because you couldn't find a number. Use it only when you know the person has no work mobile.

---

## File format

- **Encoding:** UTF-8 (a BOM is fine). If the file comes from Excel, use *CSV UTF-8*. A Windows-1257 file (Excel's
  default on Latvian Windows) is also read correctly.
- **Delimiter:** comma, or semicolon (what Excel uses with Latvian regional settings), or tab. It is detected from
  the header line.
- **Header:** the first line, with a `upn` column and at least one importable column.
- **Quoting:** quote a cell with `"` if it contains the delimiter or quotes; double any quote inside: `"Head of ""X"""`.
- **Apostrophe prefix:** the downloaded list writes cells starting with `+`, `-`, `=` or `@` as `'+371 26 555 444`
  so spreadsheets don't treat them as formulas. That leading `'` is removed on import, so you can keep it or drop it.
- **Size:** at most 2,000 rows per file. Empty lines are skipped.

### Example

Downloaded:

```csv
upn,company,missing,department,displayName,jobTitleLv,jobTitleEn,mobilePhone,noMobile
anna.berzina@tenaxgrupa.lv,tenapors,jobTitleLv jobTitleEn,Loģistika,Anna Bērziņa,,,'+371 26 555 444,
laura.ozola@tenaxgrupa.lv,vareno,jobTitleEn mobilePhone,Finanses,Laura Ozola,Grāmatvede,,,
karlis.vitols@tenaxgrupa.lv,tenaxinstall,jobTitleEn,Montāža,Kārlis Vītols,Montāžas brigadieris,,'+371 26 444 555,
```

Filled in (Anna's title came from her manager; Laura has no work mobile):

```csv
upn,company,missing,department,displayName,jobTitleLv,jobTitleEn,mobilePhone,noMobile
anna.berzina@tenaxgrupa.lv,tenapors,jobTitleLv jobTitleEn,Loģistika,Anna Bērziņa,Loģistikas vadītāja,Logistics Manager,'+371 26 555 444,
laura.ozola@tenaxgrupa.lv,vareno,jobTitleEn mobilePhone,Finanses,Laura Ozola,Grāmatvede,Accountant,,yes
karlis.vitols@tenaxgrupa.lv,tenaxinstall,jobTitleEn,Montāža,Kārlis Vītols,Montāžas brigadieris,Installation Foreman,'+371 26 444 555,
```

A minimal file works too. Only `upn` plus the columns you're filling are needed:

```csv
upn,jobTitleEn
laura.ozola@tenaxgrupa.lv,Accountant
karlis.vitols@tenaxgrupa.lv,Installation Foreman
```

---

## What the import does

For each row, after matching `upn`:

| Situation | Result |
|-----------|--------|
| Field is missing and the cell has a value | **Saved** as a correction. |
| Cell is empty | Nothing changes. |
| Field already has a value and the cell has the same value | Nothing changes (phone numbers are compared after formatting). |
| Field already has a value and the cell has a different one | Kept as it was; reported as "already set, kept". Change it on the person page. |
| `noMobile` = `yes` and the mobile is missing | Saved: mobile line left out. |
| Unknown `upn`, excluded account, or a company you don't edit | Row skipped with an error. |
| Same `upn` twice | The second row is skipped. |
| Invalid value (bad phone characters, too long, line break, `noMobile` not `yes`/empty, phone together with `noMobile`) | Whole row skipped; nothing from it is saved. |

Company signature editors can import only for people of the companies they edit (and download only those). Each
saved row is recorded in the activity log as `overrides.import`, showing the values before and after.

### API (for scripts)

- `GET /api/admin/missing.csv`: the downloaded list.
- `POST /api/admin/import/missing` with JSON `{ "csv": "<file contents>", "dryRun": true }`. `dryRun` defaults to
  `true` (check only). Send `false` to save. The response has `rows` (per row `line`, `upn`, `status` =
  `update` / `unchanged` / `error`, `changes`, `notes`, `error`), `ignoredColumns` and `totals`. A file that can't
  be read at all returns `400` with `error`.
