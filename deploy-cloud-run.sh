#!/bin/bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project)}"
SERVICE_NAME="${SERVICE_NAME:-mia-cvqa-service}"
REGION="${REGION:-northamerica-south1}"
IMAGE_NAME="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"
DEPLOY_ENV_FILE="${DEPLOY_ENV_FILE:-deploy-env.local.yaml}"

if [[ ! -f "${DEPLOY_ENV_FILE}" ]]; then
  echo "Missing ${DEPLOY_ENV_FILE}."
  echo "Create it from deploy-env.example.yaml and inject runtime values from Secret Manager or your shell environment."
  exit 1
fi

APP_ENVIRONMENT_VALUE="$(grep -E '^APP_ENVIRONMENT:' "${DEPLOY_ENV_FILE}" | head -n1 | cut -d':' -f2- | tr -d '\"[:space:]')"
DATABASE_SCHEMA_VALUE="$(grep -E '^DATABASE_SCHEMA:' "${DEPLOY_ENV_FILE}" | head -n1 | cut -d':' -f2- | tr -d '\"[:space:]')"

if [[ -z "${APP_ENVIRONMENT_VALUE}" || -z "${DATABASE_SCHEMA_VALUE}" ]]; then
  echo "APP_ENVIRONMENT and DATABASE_SCHEMA must both be set in ${DEPLOY_ENV_FILE}."
  exit 1
fi

if [[ "${SERVICE_NAME}" == *-test ]]; then
  [[ "${PROJECT_ID}" == "mia-web-test-env" ]] || { echo "Test CVQA services must deploy to mia-web-test-env."; exit 1; }
  [[ "${APP_ENVIRONMENT_VALUE}" == "test" ]] || { echo "Test CVQA services must use APP_ENVIRONMENT=test."; exit 1; }
  [[ "${DATABASE_SCHEMA_VALUE}" == "mia-test" ]] || { echo "Test CVQA services must use DATABASE_SCHEMA=mia-test."; exit 1; }
else
  [[ "${PROJECT_ID}" == "mia-production-project" ]] || { echo "Production CVQA services must deploy to mia-production-project."; exit 1; }
  [[ "${APP_ENVIRONMENT_VALUE}" == "prod" ]] || { echo "Production CVQA services must use APP_ENVIRONMENT=prod."; exit 1; }
  [[ "${DATABASE_SCHEMA_VALUE}" != "mia-test" ]] || { echo "Production CVQA services cannot use DATABASE_SCHEMA=mia-test."; exit 1; }
fi

echo "Deploying ${SERVICE_NAME} to ${REGION} in project ${PROJECT_ID}..."
echo "Building image via Cloud Build..."
gcloud builds submit --tag "${IMAGE_NAME}" .

echo "Deploying to Cloud Run..."
gcloud run deploy "${SERVICE_NAME}" \
  --image "${IMAGE_NAME}" \
  --platform managed \
  --region "${REGION}" \
  --allow-unauthenticated \
  --memory 1Gi \
  --cpu 1 \
  --env-vars-file "${DEPLOY_ENV_FILE}"

echo "Deployment complete."
