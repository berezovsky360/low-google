#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${1:-${GOOGLE_CLOUD_PROJECT:-}}"
REGION="${2:-${GOOGLE_CLOUD_REGION:-us-central1}}"
SERVICE_NAME="low-web"

if [[ -z "$PROJECT_ID" ]]; then
  echo "Usage: ./scripts/deploy-cloud-run.sh <GOOGLE_CLOUD_PROJECT_ID> [REGION]"
  exit 1
fi

echo "==> Configuring Google Cloud project: $PROJECT_ID (region: $REGION)"
gcloud config set project "$PROJECT_ID"

echo "==> Enabling required Google Cloud APIs (Cloud Run, Cloud Build, Artifact Registry, Firestore, KMS, Secret Manager, Vertex AI)..."
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  firestore.googleapis.com \
  cloudkms.googleapis.com \
  secretmanager.googleapis.com \
  aiplatform.googleapis.com

APPROVAL_SECRET="${LOW_APPROVAL_SECRET:-$(openssl rand -hex 32)}"

echo "==> Deploying $SERVICE_NAME to Cloud Run from source..."
gcloud run deploy "$SERVICE_NAME" \
  --source . \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated \
  --min-instances 1 \
  --cpu-boost \
  --timeout 300s \
  --concurrency 80 \
  --memory 1Gi \
  --cpu 1 \
  --set-env-vars="GOOGLE_CLOUD_PROJECT=${PROJECT_ID},GOOGLE_CLOUD_REGION=${REGION},FIREBASE_PROJECT_ID=${PROJECT_ID},LOW_KMS_KEY_NAME=projects/${PROJECT_ID}/locations/${REGION}/keyRings/low/cryptoKeys/data,LOW_REASONING_MODEL=gemini-2.5-flash,LOW_TRANSCRIPTION_MODEL=gemini-2.5-flash,LOW_EMBEDDING_MODEL=text-embedding-004,LOW_STORAGE_BUCKET=${PROJECT_ID}-low-bucket,LOW_APPROVAL_SECRET=${APPROVAL_SECRET}"

echo "==> Deployment complete! Fetching public URL:"
gcloud run services describe "$SERVICE_NAME" --region "$REGION" --format='value(status.url)'
