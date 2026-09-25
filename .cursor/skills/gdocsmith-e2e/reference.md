# End-To-End Reference

## Expectations

- Work through the gdocsmith MCP tool only.
- Read a narrow scope before changing unfamiliar content.
- Preserve frontmatter and tokens when writing an edited markdown export back.
- Do not calculate character positions or issue direct Google API calls.
- Treat a refusal as useful information. Request confirmation before allowing a
  destructive change.

## Assertions

Verify document state after each scenario using normal tool output:

- targeted text and headings match the requested state
- untouched tabs and content remain present
- tables keep expected row and column shape
- rich or unrecreatable content survives a refused operation
- the returned diff and `steps[i]` match the observed result

## Cleanup

When a scenario creates a temporary document, permanently remove it at the end
of the scenario. Do not leave trial copies in Drive.