# MinimalCortex Agent

## Purpose
A minimal CLI chat agent demonstrating the CortexAgent framework with streaming colored output (gray for reasoning, cyan for responses). Serves as a reference implementation for agents built on CortexAgent.

## Input Sources
- `CLIInputSource`: stdin → direct input, always requires a response

## Plugins
- `CortexMemoryPlugin` (auto via CortexAgent): long-term semantic memory
- `ThoughtPlugin` (auto via CortexAgent): captures `<think>` blocks as memories
- `MemoryPlugin`: short-term conversation history (multi-turn context)
- `MinimalToolsPlugin`: inline tools for get_current_time, calculate, echo

## Tools
- `get_current_time()`: returns the current local date and time
- `calculate(expression)`: evaluates a safe arithmetic expression
- `echo(text)`: echoes text back, confirming what the agent heard

## System Prompt Behavior
Helpful assistant with tools. Thinks carefully before responding. Uses internal reasoning to work through problems before giving a final answer.

## Memory
- Short-term: MemoryPlugin maintains last 15 messages, auto-summarizes older history
- Long-term: CortexMemoryPlugin stores facts, thoughts, and behaviors across sessions

## Interactions
Standalone CLI agent. Streaming tokens are displayed in real time with ANSI color coding: reasoning tokens in gray, response tokens in cyan.

## Factory
File: `src/agents/MinimalCortexAgentFactory.ts`
Export: `createMinimalCortexAgent()`
