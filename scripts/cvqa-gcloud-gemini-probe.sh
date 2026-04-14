#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PROJECT_ID="${PROJECT_ID:-}"
if [[ -z "$PROJECT_ID" ]]; then
  PROJECT_ID="$(awk -F= '/^(VERTEX_PROJECT_ID|FIREBASE_PROJECT_ID)=/{gsub(/\r/,"",$2); print $2; exit}' .env .env.local .env.gcs 2>/dev/null || true)"
fi

if [[ -z "$PROJECT_ID" ]]; then
  echo "[gcloud-probe] ERROR: Missing PROJECT_ID and no VERTEX/FIREBASE project found in env files." >&2
  exit 1
fi

echo "[gcloud-probe] Using project: ${PROJECT_ID:0:4}...${PROJECT_ID: -4}"

gcloud config set project "$PROJECT_ID" >/dev/null
gcloud config set billing/quota_project "$PROJECT_ID" >/dev/null
# Best effort; ignore if user account lacks permission.
gcloud auth application-default set-quota-project "$PROJECT_ID" >/dev/null 2>&1 || true

mkdir -p tmp

LIST_FILE="tmp/gcloud-gemini-model-list.txt"
REPORT_FILE="tmp/gcloud-gemini-probe-report.json"

{
  echo "[gcloud-probe] Listing model-garden entries matching gemini-3.1-flash..."
  gcloud ai model-garden models list \
    --project="$PROJECT_ID" \
    --billing-project="$PROJECT_ID" \
    --model-filter="gemini-3.1-flash" \
    --full-resource-name \
    --limit=200
} | tee "$LIST_FILE"

TOKEN="$(gcloud auth print-access-token)"
PAYLOAD_FILE="/tmp/gcloud_gemini_cvqa_probe_payload.json"
cat > "$PAYLOAD_FILE" <<'JSON'
{
  "contents": [
    {
      "role": "user",
      "parts": [
        {
          "text": "Devuelve SOLO JSON valido para una validacion CVQA simplificada con 1 regla: {overallStatus, summary, captureQuality:{status}, ruleResults:[{ruleId,status,sourceIndices,matchedRuleRegion,defectRegion}]}. Usa ruleId='rule-1' y coordenadas porcentuales 0..100."
        }
      ]
    }
  ],
  "generationConfig": {
    "temperature": 0,
    "responseMimeType": "application/json",
    "responseSchema": {
      "type": "OBJECT",
      "properties": {
        "overallStatus": {
          "type": "STRING",
          "enum": ["PASS", "FAIL", "REVIEW"]
        },
        "summary": {
          "type": "STRING"
        },
        "captureQuality": {
          "type": "OBJECT",
          "properties": {
            "status": {
              "type": "STRING",
              "enum": ["PASS", "FAIL", "REVIEW"]
            },
            "blur": { "type": "NUMBER" },
            "exposure": { "type": "NUMBER" },
            "framing": { "type": "NUMBER" },
            "occlusion": { "type": "NUMBER" },
            "issues": {
              "type": "ARRAY",
              "items": { "type": "STRING" }
            }
          },
          "required": ["status"]
        },
        "ruleResults": {
          "type": "ARRAY",
          "items": {
            "type": "OBJECT",
            "properties": {
              "ruleId": { "type": "STRING" },
              "status": {
                "type": "STRING",
                "enum": ["PASS", "FAIL", "REVIEW"]
              },
              "sourceIndices": {
                "type": "ARRAY",
                "items": { "type": "NUMBER" }
              },
              "matchedRuleRegion": {
                "type": "OBJECT",
                "properties": {
                  "x": { "type": "NUMBER" },
                  "y": { "type": "NUMBER" },
                  "w": { "type": "NUMBER" },
                  "h": { "type": "NUMBER" },
                  "polygon": {
                    "type": "ARRAY",
                    "items": {
                      "type": "OBJECT",
                      "properties": {
                        "x": { "type": "NUMBER" },
                        "y": { "type": "NUMBER" }
                      },
                      "required": ["x", "y"]
                    }
                  }
                }
              },
              "defectRegion": {
                "type": "OBJECT",
                "properties": {
                  "x": { "type": "NUMBER" },
                  "y": { "type": "NUMBER" },
                  "w": { "type": "NUMBER" },
                  "h": { "type": "NUMBER" },
                  "polygon": {
                    "type": "ARRAY",
                    "items": {
                      "type": "OBJECT",
                      "properties": {
                        "x": { "type": "NUMBER" },
                        "y": { "type": "NUMBER" }
                      },
                      "required": ["x", "y"]
                    }
                  }
                }
              },
              "evidenceRegions": {
                "type": "ARRAY",
                "items": {
                  "type": "OBJECT",
                  "properties": {
                    "x": { "type": "NUMBER" },
                    "y": { "type": "NUMBER" },
                    "w": { "type": "NUMBER" },
                    "h": { "type": "NUMBER" },
                    "polygon": {
                      "type": "ARRAY",
                      "items": {
                        "type": "OBJECT",
                        "properties": {
                          "x": { "type": "NUMBER" },
                          "y": { "type": "NUMBER" }
                        },
                        "required": ["x", "y"]
                      }
                    }
                  }
                }
              }
            },
            "required": ["ruleId", "status", "sourceIndices", "matchedRuleRegion"]
          }
        }
      },
      "required": ["overallStatus", "summary", "captureQuality", "ruleResults"]
    }
  }
}
JSON

MODELS=(
  "gemini-3.1-flash"
  "gemini-3.1-flash-preview"
  "gemini-3.1-flash-image-preview"
  "gemini-3.1-flash-lite-preview"
  "gemini-3.1-flash-image-preview@default"
  "gemini-3.1-flash-lite-preview@default"
  "gemini-2.5-flash"
)

node - <<'NODE' "$PROJECT_ID" "$TOKEN" "$PAYLOAD_FILE" "$REPORT_FILE" "${MODELS[@]}"
const fs = require('fs');
const cp = require('child_process');

const projectId = process.argv[2];
const token = process.argv[3];
const payloadFile = process.argv[4];
const reportFile = process.argv[5];
const models = process.argv.slice(6);

const payload = fs.readFileSync(payloadFile, 'utf8');

function callModel(model) {
  const url = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/${model}:generateContent`;
  const cmd = `curl -sS -w "\\n__HTTP__%{http_code}" -X POST -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" "${url}" -d @${payloadFile}`;
  const out = cp.execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const markerIndex = out.lastIndexOf('\n__HTTP__');
  if (markerIndex < 0) return { httpCode: 0, body: out };
  const body = out.slice(0, markerIndex);
  const httpCode = Number(out.slice(markerIndex + '\n__HTTP__'.length).trim());
  return { httpCode, body };
}

function normalizeCheck(modelText) {
  try {
    const parsed = JSON.parse(modelText);
    const validStatuses = new Set(['PASS', 'FAIL', 'REVIEW']);
    const hasCore = !!parsed.overallStatus && !!parsed.summary && Array.isArray(parsed.ruleResults);
    const statusEnumOk = validStatuses.has(String(parsed.overallStatus || '').toUpperCase());
    const first = Array.isArray(parsed.ruleResults) ? parsed.ruleResults[0] : null;
    const hasRuleCore = !!(first && first.ruleId && first.status && Array.isArray(first.sourceIndices));
    const ruleStatusEnumOk = !!(first && validStatuses.has(String(first.status || '').toUpperCase()));
    const hasRegion = !!(first && first.matchedRuleRegion);
    return {
      parseOk: true,
      hasCore,
      statusEnumOk,
      hasRuleCore,
      ruleStatusEnumOk,
      hasRegion,
      ruleCount: Array.isArray(parsed.ruleResults) ? parsed.ruleResults.length : 0,
    };
  } catch (error) {
    return {
      parseOk: false,
      error: String(error && error.message ? error.message : error),
    };
  }
}

const results = [];
for (const model of models) {
  const started = Date.now();
  try {
    const { httpCode, body } = callModel(model);
    let parsedBody;
    try {
      parsedBody = JSON.parse(body);
    } catch {
      parsedBody = null;
    }

    if (parsedBody && parsedBody.error) {
      results.push({
        model,
        httpCode,
        available: false,
        durationMs: Date.now() - started,
        error: parsedBody.error,
      });
      continue;
    }

    const text = parsedBody?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const check = normalizeCheck(text);
    results.push({
      model,
      httpCode,
      available: httpCode === 200,
      durationMs: Date.now() - started,
      modelTextPreview: String(text).slice(0, 400),
      normalization: check,
    });
  } catch (error) {
    results.push({
      model,
      httpCode: 0,
      available: false,
      durationMs: Date.now() - started,
      error: String(error && error.message ? error.message : error),
    });
  }
}

const report = {
  timestamp: new Date().toISOString(),
  projectId,
  payloadPreview: payload.slice(0, 200),
  results,
};

fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n', 'utf8');

console.log(`\n[gcloud-probe] Report written to ${reportFile}`);
for (const r of results) {
  if (r.error) {
    const msg = r.error.message || r.error;
    console.log(`[gcloud-probe] ${r.model} => HTTP ${r.httpCode} available=${r.available} error=${String(msg).slice(0, 220)}`);
    continue;
  }
  console.log(`[gcloud-probe] ${r.model} => HTTP ${r.httpCode} available=${r.available} normalize=${r.normalization?.parseOk ? 'PARSE_OK' : 'PARSE_FAIL'} core=${r.normalization?.hasCore === true} rule=${r.normalization?.hasRuleCore === true} region=${r.normalization?.hasRegion === true}`);
}

const compatible = results.some((r) => r.available && r.normalization?.hasCore && r.normalization?.statusEnumOk && r.normalization?.hasRuleCore && r.normalization?.ruleStatusEnumOk && r.normalization?.hasRegion);
process.exitCode = compatible ? 0 : 2;
NODE

echo "[gcloud-probe] Done."
