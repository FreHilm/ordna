# Ordna PRD + TUI Specification

## Overview
Ordna is a Git-native project management system where:
- Tasks are Markdown files
- Git is the source of truth
- UI/TUI render a Kanban board from file state
- Humans and AI agents operate directly on the repo

## Goals
- Replace external PM tools with Git + Markdown
- Enable AI agents to operate on tasks natively
- Provide CLI and TUI interfaces
- Create a Webbased Kanban iterface 
- Keep system local-first

## Acceptance Criteria
- [ ] A core library 
- [ ] A Shared API to work with the data structure
- [ ] A workable Kanban TUI, smart, sleek and easy
- [ ] A workable clean Web Kanban also smart, sleek and easy. Drag and drop enabled 
- [ ] Backwards compatability with Backlog.md - https://github.com/MrLesk/Backlog.md
- [ ] Derived backlog status
- [ ] I want the default folder used to be tasks/ in the project dir. 

## Notes of Ordna
I am creating this framework and tools to create a AI and Human synergy when developing. 
A solution that don't require external servers and can be truly local. My aim is to include
it into my AI first IDE that i am building. It will both use the Web Kanban and TUI. 
The IDE is built in electron so i want these tools to be compatible.

## Users
- Developer
- Product Manager
- AI Agent

## Task Structure

### File Location
/tasks/T-001.md

### Frontmatter
---
id: T-001
title: Implement payment flow
status: todo
assignee: null
priority: high
tags: [payments]
depends_on: []
created_at: 2026-04-18
updated_at: 2026-04-18
---

### Body
## Goal
...

## Acceptance Criteria
- [ ] ...

## Notes
...

## Progress
...

## Status Model
todo → doing → done

## Board Model
Derived from status (no central board file)

## CLI Commands
Ordna list
Ordna show T-001
Ordna create "New task"
Ordna move T-001 doing
Ordna assign T-001 fredrik

## TUI Layout
Columns: TODO | DOING | DONE
Keyboard navigation:
- Arrows to move
- Enter to open
- m to move
- a to assign
- e to edit
- c to create
- / to search
- q to quit

## Web
Columns: TODO | DOING | DONE
Modern look
Simple
Drag and drop 
Fastload
Darkmode

## Architecture
Filesystem (Git repo)
→ Parser
→ State model
→ TUI/CLI
→ Git commit layer

## File Structure
/tasks/
.Ordna/config.yaml

## Principles
- Files are the API
- No hidden state
- Git is source of truth

## Roadmap
V1: Parser, CLI, basic TUI
V2: Editing, filtering, Git automation
V3: AI integration
