<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/04e6cef8-b58b-4b07-b579-320ae05d7941

## Run Locally

**Prerequisites:** Node.js on Windows


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Install the private local faster-whisper runtime once:
   `npm run setup:whisper`
4. Start the app and localhost transcription service together:
   `npm run dev:local`

The first transcription downloads the selected English Whisper model into `.runtime/whisper-models`. Audio remains local and temporary upload files are deleted after each job.

### Google AI Studio + local Whisper

1. Run `npm run setup:whisper` once, then run `npm run whisper:service` whenever the AI Studio app is open.
2. Copy the token shown by setup, or run `Get-Content .runtime\whisper-access-token.txt`.
3. In the app Settings, keep the companion URL as `http://127.0.0.1:8765` and paste the token into **AI Studio Access Token**.
4. Approve Chrome's local-network permission if prompted. The companion accepts authenticated Google AI Studio preview origins and never uploads audio beyond the PC.

If AI Studio uses a different preview origin, start the service after setting `WHISPER_ALLOWED_ORIGINS` to that exact HTTPS origin.
