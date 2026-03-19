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
