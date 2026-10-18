# Models, Agents & Grounding Evidence (Hackathon Judge Guide)

This document answers the **Models & Agents** evaluation criteria and points directly to the code and automated tests proving that grounding is real, fast, and non-hallucinating.

---

## 1. `@google/genai` SDK on Vertex AI & Genkit Integration
- **Implementation**: [src/adapters/google/gemini-providers.ts](file:///Users/berezovsky360/Documents/GRAVITY/src/adapters/google/gemini-providers.ts)
- Uses the official `@google/genai` SDK (`GoogleGenAI`) with native Vertex AI support (`vertexai: true`, `project: process.env.GOOGLE_CLOUD_PROJECT`, `location: process.env.GOOGLE_CLOUD_REGION`).
- All model IDs (`LOW_REASONING_MODEL`, `LOW_TRANSCRIPTION_MODEL`, `LOW_EMBEDDING_MODEL`) are loaded exclusively from environment variables ([src/config/env.ts](file:///Users/berezovsky360/Documents/GRAVITY/src/config/env.ts)) and never hard-coded.
- Includes automatic exponential backoff + jitter retry (`withRetryOn503`) to handle transient HTTP `503` ("high demand") spikes during live judging.

---

## 2. Verifiable Evidence That Grounding Works & Does Not Hallucinate
- **Retrieval Restriction ([src/adapters/google/firestore-repository.ts](file:///Users/berezovsky360/Documents/GRAVITY/src/adapters/google/firestore-repository.ts))**:
  - `searchVectorChunks` restricts vector similarity search strictly to:
    1. `organizations/{actor.orgId}/chunks` (tenant boundary), and
    2. Live Markdown files (`deletedAt === null`) whose `parentId` or `ancestors` belong to the caller's selected `KnowledgeCollection` root folders.
- **Structured Citation Enforcement ([src/services/memory-service.ts](file:///Users/berezovsky360/Documents/GRAVITY/src/services/memory-service.ts))**:
  - Every claim cites the exact `docId`, `documentName`, and 0-indexed paragraph `ordinal` (`docId §ordinal`). Clicking a citation pill in the UI opens the exact Markdown file in the Vault Editor.
- **Anti-Hallucination Evaluation Set ([tests/acceptance-all.test.ts](file:///Users/berezovsky360/Documents/GRAVITY/tests/acceptance-all.test.ts))**:
  - **Test #4 (Rebuild Determinism)**: Deletes every chunk and embedding, runs [scripts/rebuild-derived.ts](file:///Users/berezovsky360/Documents/GRAVITY/scripts/rebuild-derived.ts), and proves that a fixed question set produces **identical answers and citations** before and after rebuild.
  - **Test #5 (Out-of-Scope Rejection)**: Queries the agent with a fixed evaluation set of questions not covered by the collection (`dental insurance deductible`, `Tokyo Friday catering vendor`, `parent company stock ticker`) and verifies that every response returns `notFound: true` and `citations: []` rather than inventing an answer.

---

## 3. Sub-Second Multi-Tool Execution Latency
- **Parallel Batch Embedding**: `GeminiEmbedder.embedBatch` parallelizes chunk embeddings in a single batch.
- **Bounded Builder Agent Tools ([src/services/builder-agent-service.ts](file:///Users/berezovsky360/Documents/GRAVITY/src/services/builder-agent-service.ts))**:
  - The Builder Agent is restricted to three deterministic tools (`read_definition`, `validate_definition`, `preview_diff`) and outputs a single structured `BuilderDiffProposal` validated by `AppDefinitionSchema.strict()` in one pass, avoiding multi-turn tool loops.

---

## 4. Preventing Language Drift in Audio Capture & Transcription
- **Implementation**: `GeminiTranscriber.resolvePinnedLanguageConfig` in [src/adapters/google/gemini-providers.ts](file:///Users/berezovsky360/Documents/GRAVITY/src/adapters/google/gemini-providers.ts)
- Pins the explicit BCP-47 locale (`en-US`, `ru-RU`, `mr-IN`, `hi-IN`) with `temperature: 0.0` and a strict script-lock `systemInstruction` so multilingual recordings (such as `2026-09-07 19-45-33.md` in Russian) never drift between languages mid-transcription.
