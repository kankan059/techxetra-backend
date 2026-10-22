# Seed Data Mapping and Import Rules

If `techxetra_2026_events.json` is included with the pack, use it as initial event data. It is input data, not a schema authority. The importer must validate and report all mappings, missing fields, and rejected records. It must be safe to rerun and must not create duplicate events.

## Requirements
- Preserve all valid event records and meaningful source fields; do not silently drop fields such as festival day, event format, rules, organizer, eligibility, prizes, timelines, registration details, or category.
- Build a dry-run mode that prints counts, mapping warnings, generated slugs, amount conversions, and errors without writing to the database.
- Match existing events using a stable explicit source key if present; otherwise use a deterministic slug plus source identity. Do not use `INSERT OR REPLACE` semantics that can delete/overwrite relationships.
- Run each import batch transactionally or report per-record outcomes precisely. Rerunning an unchanged seed must not duplicate events, users, or staff assignments.
- Convert INR to paise exactly once (`round(INR * 100)` only after validating decimal input). If source values are already in paise, do not multiply again. Preserve zero-price events as FREE.
- Map categories explicitly: `TECHNICAL`, `CULTURAL`, `E_SPORTS`, `SPORTS`, `MANAGEMENT`, `LITERARY`, `WORKSHOP`, `INTERACTIVE`, `RECREATIONAL`, `SHOWCASE`, `OTHER`. Unknown values must be reported and either rejected or mapped through a documented rule; never silently coerce.
- Map price model explicitly. `PER_TEAM` must be recognized from a normalized value, not one exact display string. Free event means `FREE`; paid individual event means `PER_PARTICIPANT`; paid team event can mean `PER_TEAM` only when source semantics confirm it.
- Preserve capacity as unlimited when source means unlimited/unknown. Do not invent a capacity. Map capacity unit to `SEATS`, `TEAMS`, or `ENTRIES` based on event rules and record assumptions.
- Preserve festival day/day number explicitly. Do not distribute events by array index.
- Preserve event format and min/max team size. If absent, use a conservative documented default and emit a warning requiring owner review.
- Import only public event data and intended initial configuration. Never import local environment files, credentials, passwords, session records, `.dev.vars`, `.wrangler`, or secret files.
- Do not seed real admin credentials from JSON. Create the first Super Admin through a documented one-time bootstrap command that reads credentials from environment or uses a secure setup token.

## Import output
Report: source rows, inserted, updated, unchanged, rejected, warnings, per-category counts, price conversions, unresolved categories, unresolved format/team size/capacity/day fields. Exit nonzero if records are rejected unless an explicit `--allow-rejected` flag is used.
