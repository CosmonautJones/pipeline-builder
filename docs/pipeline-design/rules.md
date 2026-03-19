# Pipeline Rules

1. Node IDs must be `lowercase-kebab-case`
2. Every `action` node must have a `tool` field (use `shell:exec` as fallback)
3. Use `{{ variable_name }}` for dynamic values in toolInput
4. Place `human-review` nodes before destructive operations (deploy, delete, publish)
5. Add `retry` policies to network-dependent steps
6. Never hardcode secrets — use the `secrets` array
7. Maximize parallelism — if steps are independent, don't chain them
8. Run `pb validate` after generating to catch structural errors

## Validation commands

```bash
pb validate .pipelines/<name>.pipeline.yaml          # Check structure
pb run .pipelines/<name>.pipeline.yaml --dry-run     # Simulate execution
pb export .pipelines/<name>.pipeline.yaml -t all     # Export to tool configs
```
