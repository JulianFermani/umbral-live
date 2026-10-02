import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { HAZARDS, makeVerdict } from "./policy.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
try {
  const envFile = await readFile(resolve(projectRoot, ".env"), "utf8");
  for (const line of envFile.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
    }
  }
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const PORT = Number(process.env.PORT || 8787);
const MAX_TEXT_LENGTH = Number(process.env.MAX_TEXT_LENGTH || 12000);
const BLOCK_THRESHOLD = Number(process.env.BLOCK_THRESHOLD || 0.7);
const REVIEW_THRESHOLD = Number(process.env.REVIEW_THRESHOLD || 0.35);
const API_KEY = process.env.TYPESAFE_API_KEY;
const BASE_URL = (process.env.TYPESAFE_BASE_URL || "https://api.typesafe.ai").replace(/\/$/, "");
const MODEL = process.env.JEV_MODEL || "jev-latest";
const MAX_BLOCKS = 12;
const MAX_BLOCK_CHARS = 1800;
const MAX_BLOCK_STATE_CHARS = 12000;

function send(response, status, payload) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type"
  });
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > Math.max(MAX_TEXT_LENGTH * 4 + 2048, 1_000_000)) {
      const error = new Error("Request body too large");
      error.status = 413;
      throw error;
    }
  }
  try {
    return JSON.parse(body);
  } catch {
    const error = new Error("Request body must be valid JSON");
    error.status = 400;
    throw error;
  }
}

const server = createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type"
    });
    return response.end();
  }

  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  if (request.method === "GET" && url.pathname === "/health") {
    return send(response, 200, { status: "ok", provider: "typesafe", model: MODEL, configured: Boolean(API_KEY) });
  }

  if (request.method !== "POST" || !["/api/moderate", "/api/moderate/blocks"].includes(url.pathname)) {
    return send(response, 404, { error: "Not found" });
  }
  if (!API_KEY) {
    return send(response, 503, { error: "TYPESAFE_API_KEY is not configured. Copy .env.example to .env and add your key." });
  }

  try {
    const body = await readJson(request);

    if (url.pathname === "/api/moderate/blocks") {
      if (!Array.isArray(body?.blocks) || body.blocks.length === 0) {
        return send(response, 400, { error: "blocks must be a non-empty array" });
      }
      if (body.blocks.length > MAX_BLOCKS) {
        return send(response, 413, { error: `A maximum of ${MAX_BLOCKS} blocks can be classified per request` });
      }

      let stateChars = 0;
      const blocks = [];
      const context = typeof body.context === "string" ? body.context.trim().slice(0, 500) : "";
      const seenIds = new Set();
      for (const block of body.blocks) {
        const id = typeof block?.id === "string" ? block.id : "";
        const text = typeof block?.text === "string" ? block.text.trim().slice(0, MAX_BLOCK_CHARS) : "";
        if (!/^[\w-]{1,32}$/.test(id) || seenIds.has(id) || !text) {
          return send(response, 400, { error: "Each block needs a unique, valid id and non-empty text" });
        }
        if (stateChars + text.length > MAX_BLOCK_STATE_CHARS) break;
        seenIds.add(id);
        stateChars += text.length;
        blocks.push({ id, text });
      }
      if (blocks.length === 0) return send(response, 400, { error: "No block text fit within the request size limit" });

      const questionTargets = [];
      const questions = {};
      for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
        const block = blocks[blockIndex];
        for (const [category, hazardInstructions] of Object.entries(HAZARDS)) {
          const questionId = `b${blockIndex}_${category}`;
          questions[questionId] = {
            type: "noul",
            instructions: `Evaluate only the content block with id ${block.id}. ${hazardInstructions} Treat this as an independent block and ignore the other blocks in the state.`
          };
          questionTargets.push({ blockId: block.id, category, questionId });
        }
      }

      const upstream = await fetch(`${BASE_URL}/v1/systemone`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${API_KEY}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({ state: { context, blocks }, model: MODEL, questions }),
        signal: AbortSignal.timeout(15000)
      });
      const result = await upstream.json().catch(() => ({}));
      if (!upstream.ok) {
        return send(response, upstream.status === 429 ? 429 : 502, {
          error: "TypeSafe request failed",
          upstreamStatus: upstream.status,
          detail: result.error?.message || result.detail || result.message || "No upstream error detail"
        });
      }

      const answers = result.answers || {};
      const blockAnswers = new Map(blocks.map(({ id }) => [id, {}]));
      for (const { blockId, category, questionId } of questionTargets) {
        blockAnswers.get(blockId)[category] = answers[questionId] || { noul: 0 };
      }
      return send(response, 200, {
        blocks: blocks.map(({ id }) => {
          const hazards = blockAnswers.get(id);
          const verdict = makeVerdict(hazards, { blockThreshold: BLOCK_THRESHOLD, reviewThreshold: REVIEW_THRESHOLD });
          return { id, action: verdict };
        }),
        model: result.model || MODEL,
        usage: result.usage || null,
        requestId: result.request_id || result.requestId || null
      });
    }

    if (url.pathname !== "/api/moderate") return send(response, 404, { error: "Not found" });
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    if (!text) return send(response, 400, { error: "text must be a non-empty string" });
    if (text.length > MAX_TEXT_LENGTH) {
      return send(response, 413, { error: `text exceeds the ${MAX_TEXT_LENGTH} character limit` });
    }

    const questions = Object.fromEntries(
      Object.entries(HAZARDS).map(([name, instructions]) => [name, { type: "noul", instructions }])
    );
    const upstream = await fetch(`${BASE_URL}/v1/systemone`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${API_KEY}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ state: text, model: MODEL, questions }),
      signal: AbortSignal.timeout(15000)
    });

    const result = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      const status = upstream.status === 429 ? 429 : upstream.status >= 500 ? 502 : 502;
      return send(response, status, {
        error: "TypeSafe request failed",
        upstreamStatus: upstream.status,
        detail: result.error?.message || result.detail || result.message || "No upstream error detail"
      });
    }

    const answers = result.answers || {};
    return send(response, 200, {
      action: makeVerdict(answers, { blockThreshold: BLOCK_THRESHOLD, reviewThreshold: REVIEW_THRESHOLD }),
      model: result.model || MODEL,
      usage: result.usage || null,
      requestId: result.request_id || result.requestId || null
    });
  } catch (error) {
    const status = error.status || (error.name === "TimeoutError" ? 504 : 500);
    return send(response, status, { error: error.message || "Internal server error" });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Umbral backend listening at http://127.0.0.1:${PORT}`);
  console.log(`Jev configured: ${Boolean(API_KEY)} (model: ${MODEL})`);
});
