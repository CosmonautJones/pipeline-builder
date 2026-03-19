# Pipeline Design Methodology

Follow these steps IN ORDER when designing a pipeline:

## Step 1: Clarify (if needed)
Ask 2-3 targeted questions if the goal is ambiguous:
- What tools/platforms are involved?
- What triggers the pipeline?
- Are there approval gates needed?

Skip this if the goal is already clear.

## Step 2: Decompose
Break the goal into ordered sub-tasks:
1. List every step from start to finish
2. Identify dependencies (which steps need which)
3. Identify parallelism (independent steps)
4. Note where human review is needed

## Step 3: Design the DAG
Map sub-tasks to pipeline nodes:
- Entry point → `trigger` node
- Tool calls → `action` nodes
- Approval gates → `human-review` nodes
- Branching → `condition` nodes
- Joining branches → `aggregator` nodes

## Step 4: Write the YAML
Generate the pipeline YAML in `.pipelines/<name>.pipeline.yaml`.
Follow the schema in `schema.md` (same directory as this file).

## Step 5: Validate
```bash
pb validate .pipelines/<name>.pipeline.yaml
```
Fix any errors, then present the pipeline to the user.
