# Freshservice AI Reply Assistant

Chrome Extension (Manifest V3) that generates AI draft replies for 
Freshservice support tickets using GPT-4o with Gemini 2.0 Flash fallback.

## Setup

1. Clone the repo
2. Copy `secrets.example.json` → `secrets.json` and fill in your values
3. Go to `chrome://extensions` → Enable Developer Mode → Load Unpacked
4. Open the extension Options page
5. Click "📂 Load from secrets.json" and select your file
6. Click Save

## secrets.json fields

| Key | Description |
|---|---|
| fsSubdomain | Your Freshservice subdomain (e.g. `mycompany` from mycompany.freshservice.com) |
| fsApiKey | Found in Freshservice → Profile Settings → API Key |
| openaiKey | platform.openai.com → API Keys |
| geminiKey | aistudio.google.com → Get API Key |
| primaryModel | `openai` or `gemini` |
| companyName | Injected into the AI system prompt |

## secrets.json is gitignored — never commit it.
