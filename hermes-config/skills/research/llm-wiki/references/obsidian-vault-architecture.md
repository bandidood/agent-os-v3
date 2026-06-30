# Obsidian LLM Vault Architecture

Reference for building a Git-hosted Obsidian vault with LLM Wiki layer.
Pattern used for bandidood/vault (2026-05-17).

## Structure: PARA + LLM Wiki Hybrid

```
vault/
├── 00_Inbox/              → Capture rapide, imports
├── 01_Context/            → North Star, principes, objectifs
├── 02_Daily/              → Journal, weekly reviews, décisions (ADR)
│   ├── daily-notes/
│   ├── weekly-reviews/
│   └── decision-log/
├── 03_Projects/           → Projets actifs, en attente, complétés
│   ├── active/
│   ├── waiting/
│   └── completed/
├── 04_Areas/              → Domaines de responsabilité (cyber, cloud, OT)
├── 05_Business/           → Entreprise, clients, offres
├── 06_Library/            → Frameworks, patterns, Zettelkasten
│   ├── frameworks/
│   ├── architecture-patterns/
│   └── notes-permanentes/
├── 07_Reference/          → Sources, standards, snippets
│   ├── sources/
│   ├── standards/
│   └── snippets/
├── 08_Skills/             → SOP, playbooks, prompts, templates
├── 09_Agents/             → Policies et configuration agents IA
│   ├── hermes/
│   └── policies/
├── 10_Artifacts/          → Rapports, diagrammes, exports
│   ├── reports/
│   ├── diagrams/
│   └── exports/
├── 90_Audit/              → Logs, consistency checks
│   ├── logs/
│   └── consistency-checks/
│
│  ── LLM Wiki Layer ──
│
├── wiki/                   → Knowledge base interconnectée
│   ├── hot.md              → Cache contextuel ~500 mots (mis à jour chaque session)
│   ├── index.md            → Carte d'accès au wiki
│   ├── concepts/           → Idées, principes, patterns
│   ├── entities/           → Personnes, outils, organisations
│   ├── sources/            → Références et origine des connaissances
│   ├── questions/          → Questions ouvertes et résolues
│   ├── comparisons/        → Benchmarks et comparaisons
│   ├── folds/              → Snapshots compacts de sessions de recherche
│   └── canvases/           → Vues visuelles Obsidian
│
│  ── Source Layer (immuable) ──
│
├── .raw/                   → Documents bruts avant ingestion (jamais modifié par l'agent)
│
│  ── Meta Files ──
│
├── _HOME.md                → Page d'accueil du vault avec navigation
├── _INDEX.md               → Index global (MOC)
├── _TAGS.md                → Taxonomie des tags
├── _DECISIONS.md           → Registre des décisions (ADR)
├── _AGENT_POLICY.md        → Règles de gouvernance des agents
├── _SYNC_POLICY.md         → Règles de synchronisation
├── _templates/             → Templates Obsidian ( Templater )
├── _attachments/           → Images et fichiers partagés
└── .gitignore              → Obsidian/workspace, cache, system files
```

### Key Differences from Pure LLM Wiki

- **PARA prefix** (00-90) provides PARA-inspired organization for personal/operational notes
- **wiki/ directory** is the LLM Wiki knowledge base — concepts, entities, sources, questions
- **`.raw/` replaces `raw/`** — dot-prefix hides it in Obsidian sidebar (cleaner UX)
- **`_HOME.md`** serves as the vault entry point with quick links to both PARA and wiki sections
- **`_AGENT_POLICY.md`** governs multi-agent access (only for vaults with AI agents)
- **`_DECISIONS.md`** doubles as ADR registry (PARA) and decision source (wiki)
- **`hot.md`** is the session cache — ~500 words, updated every agent session, read first

## Sync: Obsidian Git Bidirectional (No CouchDB)

```
Obsidian Desktop (Mac/PC)
      ⇅  Obsidian Git plugin (auto-commit + push/pull)
  GitHub (bandidood/vault)
      ⇅  git pull/push (5 min cron or manual)
  Serveur VPS / Agents
      ⇅  lecture/écriture (agents)
```

### Obsidian Git Plugin Setup
- Install "Obsidian Git" from community plugins
- Enable auto-backup: commit every 5 min, push on commit
- Pull on open: to sync changes from agents
- Commit message convention: `vault: <description>` (no WIP)
- Conflict resolution: prefer rebase, manual resolution for complex conflicts

### Agent Access
- **Hermes**: read-only except for validated instructions and `wiki/hot.md` updates
- **Jean Claude (Claude OS)**: read/write via git push
- **LightRAG**: read-only for indexing

### Why No CouchDB
Simplified from the original LiveSync + CouchDB + GitHub three-way sync. CouchDB adds:
- Another service to maintain
- Conflict resolution complexity across 3 sources
- Encryption overhead
- Debugging headaches

Obsidian Git provides sufficient bidirectional sync for a single-user vault with agent access. The tradeoff: near-realtime mobile sync is lost, but for a desktop + server workflow this is fine.

## Hot Cache Pattern

`wiki/hot.md` is the first file an agent reads at session start. Structure:

```markdown
---
title: "🔥 Hot Cache"
type: wiki-hot
tags: [wiki, meta, hot-cache]
updated: YYYY-MM-DD
---

# 🔥 Hot Cache

~500 words max. Updated every session.

## Contexte actuel
- Key recent events / state changes

## Projets actifs
- Current work items

## Dernières décisions
- DEC-YYYY-NNN: description

## À retenir
- Facts that prevent re-discovery
```

Rules:
- **Maximum 500 words** — beyond that, fold into `wiki/folds/`
- **Updated every session** by the active agent
- **Stale entries folded** — when info moves to a fold or wiki page, remove from hot cache
- **Never duplicate** — if info exists in a fold or wiki page, remove from hot cache

## Tags Taxonomy (Example)

```
# Domain
domain/cybersecurity  domain/cloud  domain/business  domain/ot

# Type
type/project  type/decision  type/sop  type/reference  type/context  type/agent

# Status
status/draft  status/active  status/valid  status/archived  status/blocked

# Classification
class/internal  class/client  class/confidential  class/public

# Review cycle
review/weekly  review/monthly  review/quarterly  review/yearly

# Agent
agent/claude-os  agent/hermes  agent/lightrag

# Wiki (new layer)
wiki/concept  wiki/entity  wiki/source  wiki/question  wiki/fold  wiki/comparison
```

## Creating This Vault From Scratch

1. Create repo on GitHub with `.gitignore` for Obsidian
2. Clone locally and create the full directory structure above
3. Write `_HOME.md`, `_INDEX.md`, `_TAGS.md`, `_DECISIONS.md`, `_AGENT_POLICY.md`, `_SYNC_POLICY.md`, `blueprint.md`
4. Write `wiki/hot.md`, `wiki/index.md`, and each `_index.md` for wiki subdirs
5. Seed `wiki/concepts/` with foundational concepts (LLM Wiki Pattern, Compounding Knowledge, Hot Cache, Source-First Synthesis)
6. Seed `wiki/comparisons/` with key comparisons (Wiki vs RAG)
7. Commit and push
8. Open in Obsidian Desktop, install Obsidian Git plugin
9. Configure agents with read/write access to the repo

## Decision Records (ADR) in the Vault

DECISIONS.md tracks architectural decisions with format:
```
| ID | Date | Titre | Statut | Décideur |
| DEC-2026-001 | 2026-04-29 | Source of truth: Obsidian | ✅ Validé | Johann |
```

Status values: ✅ Validé, 🔄 En révision, ❌ Obsolète, 📋 Proposé