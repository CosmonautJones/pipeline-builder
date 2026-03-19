# Pipeline YAML Schema Reference

```yaml
apiVersion: pipeline-builder/v1

metadata:
  name: string                     # Pipeline name
  version: "1.0.0"                 # Semver
  description: string              # What this pipeline does
  tags: [string]                   # Categorization

variables:                         # User-provided at runtime
  - name: string
    type: string | number | boolean | object | secret
    description: string
    default: any                   # Omit for required vars
    required: boolean

secrets: [string]                  # Secret names (NEVER store values)

trigger:
  type: manual | cron | webhook | event | file-watch
  config: {}

nodes:                             # DAG vertices
  - id: lowercase-kebab-case       # Unique node ID
    name: string                   # Human-readable
    type: action | condition | transform | human-review | sub-pipeline | trigger | aggregator
    tool: "server:tool_name"       # For action nodes
    toolInput:                     # Use {{ var }} for templates
      command: "npm test"
    dependsOn: [node_id]           # Must complete first
    inputMappings:                 # Data flow from other nodes
      param: "nodes.prev.outputs.field"
      param: "variables.var_name"
    condition: "{{ var }} == 'value'"  # For condition nodes
    humanReview:                   # For human-review nodes
      prompt: "Approve?"
      approvalRequired: true
    retry:                         # Retry policy
      maxAttempts: 3
      backoffMs: 1000
      backoffMultiplier: 2
    errorPolicy: fail | skip       # fail = stop, skip = continue
    timeoutMs: 30000

edges:                             # Explicit connections (alt to dependsOn)
  - from: node_id
    to: node_id
    condition: string              # Optional guard

mcpServers:                        # Required MCP servers
  - name: string
    command: "npx"
    args: ["-y", "package-name"]
    transport: stdio
```
