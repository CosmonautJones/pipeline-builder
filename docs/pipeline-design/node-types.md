# Node Type Guide

| Need to...                       | Use type        | Example                          |
|----------------------------------|-----------------|----------------------------------|
| Start the pipeline               | `trigger`       | Webhook, cron, manual start      |
| Run a command or tool            | `action`        | `npm test`, API call, deploy     |
| Branch on a condition            | `condition`     | if env == "production"           |
| Transform data between steps     | `transform`     | Format output for next step      |
| Pause for human approval         | `human-review`  | Before deploy, before delete     |
| Run another pipeline             | `sub-pipeline`  | Reusable sub-workflows           |
| Join parallel branches           | `aggregator`    | Collect results from parallel    |

## Common action patterns

```yaml
# Shell command
- id: run-tests
  type: action
  tool: "shell:exec"
  toolInput: { command: "npm test" }

# With retry for flaky operations
- id: deploy
  type: action
  tool: "shell:exec"
  toolInput: { command: "kubectl apply -f k8s/" }
  retry: { maxAttempts: 3, backoffMs: 2000 }

# Human gate before destructive ops
- id: approve-deploy
  type: human-review
  humanReview:
    prompt: "Deploy to {{ environment }}?"
    approvalRequired: true

# Parallel steps (same dependsOn)
- id: lint
  type: action
  tool: "shell:exec"
  toolInput: { command: "npm run lint" }
  dependsOn: [checkout]
  errorPolicy: skip              # Non-blocking

- id: test
  type: action
  tool: "shell:exec"
  toolInput: { command: "npm test" }
  dependsOn: [checkout]          # Same dep = parallel with lint
```
