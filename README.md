# Umbral Live

**Real-time web filtering, with judgment.**

Umbral Live is an open-source proof of concept exploring how far [Jev](https://docs.typesafe.ai/models)—TypeSafe's fast, structured decision model—can take a real-time browser content filter. It watches changing page content, classifies text blocks, and can blur risky cards before you open them.

The goal is ambitious: explore whether a browser can continuously understand web content instead of relying only on static URL and keyword lists. The current prototype is a step toward that idea, not a claim that every element or every page on the web is already covered. It currently classifies up to 12 text blocks per scan using DOM heuristics; image analysis and broader site-specific coverage are future work.

## How it works today

- A local Node.js backend keeps the TypeSafe API key out of the extension and sends classification requests to Jev.
- A Chrome Manifest V3 content script watches HTTP and HTTPS pages for visible text changes. It waits about 100 ms after a change before scanning; rapidly changing sites can generate many requests.
- The scanner selects up to 12 candidate cards or text blocks, with a combined text budget of about 12,000 characters. It also includes text from fields identified as search boxes.
- The backend asks seven independent Jev questions for each candidate block in one request: explicit sexual content, profanity, hate, violence, self-harm, drugs, and spam.
- If a block crosses the configured block threshold, Umbral blurs its whole card, makes it inert, and places a click-blocking cover over it. Use **Reveal card** to restore it. The page itself is not covered by a full-screen block screen.
- A floating HUD reports when a scan is waiting or in progress, category probabilities, affected cards, and estimated cost. It stays open until you close it; click it again to reopen it.
- The popup supports English and Spanish (**EN | ES**), manual text or tab checks, per-request cost estimates, and a local spending history.

Candidate selection is heuristic and recognizes common structures such as articles, list items, search-result cards, and paragraphs. Some sites use unusual or deeply nested DOM layouts, so coverage can vary. This prototype analyzes **text only**; it does not classify images, audio, or video.

## Privacy and request costs

The extension sends detected text blocks and, when present, search-box text to the local backend. The backend forwards that content to TypeSafe for Jev classification. Umbral does not save page text; it stores only request timestamps, input-token counts, model IDs, and estimated costs in the browser's `chrome.storage.local`.

Each scan can incur a TypeSafe charge. There is no per-tab request cap: a very dynamic page may trigger repeated analyses. Older results are ignored when a newer scan is already underway, but requests already sent can still be billed. Pause live scanning from the popup whenever you want.

The popup estimates spending at the published Jev input rate of **US$0.042 per million tokens** and converts it to ARS using a fixed **AR$1,500 per USD**. Both are estimates; inspect `usage.input_tokens` and your TypeSafe account for actual usage and billing terms. The local history keeps up to 10,000 requests and can be cleared in the popup.

## Requirements

- Node.js 20 or later.
- A TypeSafe API key from [console.typesafe.ai/keys](https://console.typesafe.ai/keys).
- Chrome for the current browser extension prototype.

## Run the backend locally

From the project directory:

```sh
cp .env.example .env
```

Add your key to `TYPESAFE_API_KEY` in `.env`, then start the backend:

```sh
npm start
```

The server listens on `127.0.0.1:8787` by default and does not log or persist submitted page text. Check it with:

```sh
curl http://127.0.0.1:8787/health
```

Try a single text classification:

```sh
curl http://127.0.0.1:8787/api/moderate \
  -H 'content-type: application/json' \
  -d '{"text":"A harmless example sentence to classify."}'
```

The response includes per-category probabilities and an `allow`, `review`, or `block` action. All hazard questions for one text are evaluated in a single Jev request.

## Load the Chrome extension

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked** and choose this project's `extension/` directory.
4. Pin Umbral Live from the extensions menu to open its popup.

Chrome asks for permission to read website content so the live scanner can run. Pages such as `chrome://` and the Chrome Web Store do not allow content-script injection. After installing or updating the extension, already-open tabs may need to be reloaded.

## Configuration

Backend settings are read from environment variables or the project's `.env` file:

| Variable | Default | Description |
|---|---:|---|
| `TYPESAFE_API_KEY` | — | Secret TypeSafe API key; keep it in the backend, never in the extension. |
| `TYPESAFE_BASE_URL` | `https://api.typesafe.ai` | TypeSafe API or compatible gateway URL. |
| `JEV_MODEL` | `jev-latest` | Jev model alias. |
| `PORT` | `8787` | Local backend port. |
| `MAX_TEXT_LENGTH` | `12000` | Maximum characters for manual text moderation. |
| `BLOCK_THRESHOLD` | `0.70` | Probability at or above which a block is blurred. |
| `REVIEW_THRESHOLD` | `0.35` | Probability at or above which a block is marked for review. |

Thresholds are a starting policy, not a guarantee of detection. Jev documentation notes that English is currently its strongest language; test Spanish content and tune thresholds against examples from the sites you use.

## API

- `GET /health` — backend status and whether a TypeSafe key is configured; never returns the key.
- `POST /api/moderate` — classify one text string: `{ "text": "..." }`.
- `POST /api/moderate/blocks` — classify multiple blocks in one request: `{ "context": "...", "blocks": [{ "id": "card-1", "text": "..." }] }`. Returns one action and category probabilities per block; accepts up to 12 blocks per request.

## Development and tests

```sh
npm run dev
npm test
```

The automated tests cover the moderation policy and English/Spanish UI messages without making paid TypeSafe requests.

## License

MIT. See [LICENSE](LICENSE).
