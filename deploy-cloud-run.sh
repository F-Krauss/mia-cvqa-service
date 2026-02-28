#!/bin/bash

# Configuration
PROJECT_ID=$(gcloud config get-value project)
SERVICE_NAME="mia-ai-service"
REGION="northamerica-south1"
IMAGE_NAME="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"

echo "Deploying ${SERVICE_NAME} to ${REGION} in project ${PROJECT_ID}..."

# Build the container image using Cloud Build
echo "Building image via Cloud Build..."
gcloud builds submit --tag ${IMAGE_NAME} .

# Deploy to Cloud Run
# NOTE: ALLOWED_ORIGINS must include the Firebase hosting domain and t-efficiency.com
# DATABASE_SCHEMA must match the backend (mia-test for test, mia for production)
echo "Deploying to Cloud Run..."
gcloud run deploy ${SERVICE_NAME} \
  --image ${IMAGE_NAME} \
  --platform managed \
  --region ${REGION} \
  --allow-unauthenticated \
  --memory 2Gi \
  --cpu 1 \
  --env-vars-file deploy-env.yaml

echo "Deployment complete!"
