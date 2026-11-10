# IssueSherpa

An AI guide for first-time open-source contributors. Find a beginner-friendly GitHub issue, then get a step-by-step route to fix it.

Try it LIVE: https://issuesherpa-ce103.containers.snapdeploy.app/

## What it does
- Searches open `good first issue` / `hacktoberfest` issues and ranks them for beginner fit (score, difficulty, time estimate).
- Builds a plan for any issue: analyzes it, picks the right repo files, reads them, and streams a Markdown plan live.
- Drafts the claim comment, PR description and commit message.
- "Ask Sherpa" follow-up chat that knows the issue and the plan.
- Save issues, recent history, light and dark theme.

## Stack
| Part | Tech |
|---|---|
| LLM | Groq API, `openai/gpt-oss-20b` (open-weight) |
| Orchestration | LangChain: `ChatGroq`, structured output (Pydantic), `RunnableParallel`, prompt-to-llm-to-parser chains, `.stream()` |
| Backend | Flask + Gunicorn, Server-Sent Events for live streaming |
| Data | GitHub REST API |
| Frontend | Plain HTML, CSS, JavaScript (`index.html`, `script.js`) |
| Hosting | DigitalOcean App Platform |

## Files
```
app.py            Flask backend + LangChain pipeline
index.html        Page and styles
script.js         Frontend logic (search, streaming, drafts, chat)
requirements.txt  Dependencies
.env.example      Environment variables template
deploy.md         Full setup and deploy guide (Hinglish)
document.md       Project documentation
```

## Run locally
```bash
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env     # then put your GROQ_API_KEY in .env
python app.py            # open http://localhost:8080
```

## Environment variables
| Name | Required | Default |
|---|---|---|
| `GROQ_API_KEY` | yes | Groq API key |
| `GROQ_MODEL` | no | `openai/gpt-oss-20b` |
| `REASONING_EFFORT` | no | unset (`low`, `medium` or `high`) |
| `GITHUB_TOKEN` | no | avoids GitHub rate limits |
| `RATE_LIMIT_PER_MIN` | no | `20` AI requests per IP per minute |

## Deploy
See `deploy.md`.

## License
MIT
