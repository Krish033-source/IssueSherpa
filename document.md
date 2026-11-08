# IssueSherpa: Project Document

## Problem
First-time open-source contributors lose hours before writing any code: which issue is doable, which files matter, what should the fix look like? Many give up, and maintainers get low-quality PRs.

## Solution
IssueSherpa uses an open-weight LLM (OpenAI gpt-oss-20b on Groq), orchestrated with LangChain, to:
1. Find and rank open `good first issue` + `hacktoberfest` issues by beginner fit.
2. Plan a fix: an AI pipeline reads the issue and its discussion, reads CONTRIBUTING.md, picks the relevant files, reads them, and streams a step-by-step plan.
3. Help with the human parts: claim comment, PR description, commit message, and follow-up questions.

The goal is to help beginners contribute thoughtfully, not to auto-generate PRs. The human still writes, tests and understands the code.

## Architecture
```
Browser (index.html + script.js)
   | GET  /api/search
   | POST /api/plan/stream   (Server-Sent Events)
   | POST /api/draft, /api/ask
   v
Flask (app.py) --> GitHub REST API  (issues, repo tree, files, comments)
        +--------> LangChain --> Groq API (openai/gpt-oss-20b)
```

### Plan pipeline (`/api/plan/stream`)
| Step | Action |
|---|---|
| 1 | Fetch issue, discussion, repo tree (noise filtered) and CONTRIBUTING.md from GitHub |
| 2 | LangChain `RunnableParallel`: (a) structured analysis (summary, difficulty, time, skills, risk), (b) structured file picking, at the same time |
| 3 | Picked paths are validated against the real tree (hallucinated files are dropped), then read in parallel |
| 4 | A prompt-to-ChatGroq-to-StrOutputParser chain with `.stream()` sends plan tokens to the browser live |

## LangChain usage
- `ChatGroq` for the model
- `with_structured_output(PydanticModel)` for ranking, analysis, file picking (with plain-JSON fallback)
- `RunnableParallel` and `RunnableLambda` for the parallel step
- `ChatPromptTemplate | llm | StrOutputParser` chains for plan and drafts, `.stream()` for live output

## API
| Endpoint | Description |
|---|---|
| `GET /api/search?language=&label=&q=&hacktoberfest=` | Ranked issues |
| `POST /api/plan/stream` `{url, fresh}` | SSE events: step, meta, analysis, files, token, done, error |
| `POST /api/draft` `{url, kind, plan}` | kind: claim, pr, commit |
| `POST /api/ask` `{url, question, plan, history}` | Follow-up answer |
| `GET /api/config`, `GET /healthz` | Model info, health check |

## Safety and reliability
- Issue text, comments and files are treated as untrusted data in every prompt (prompt-injection guard).
- Per-IP rate limit protects the API key. Responses from GitHub, search and plans are cached in memory.
- Markdown from the model is sanitized (DOMPurify) before it is shown.
- Graceful fallback: if AI ranking fails, issues still show unranked.

## Limitations
- GitHub search is rate-limited without `GITHUB_TOKEN`; Groq free tier has token limits.
- Plans use at most 5 files of context. Large cross-cutting issues may need more.
- Caches and rate limits live in memory (single worker); use Redis if you scale out.
- A plan is guidance, not verified code. Always review and test.

## Future work
GitHub Action that comments plans on new issues, Redis cache, repo-wide code search tool for the model.
