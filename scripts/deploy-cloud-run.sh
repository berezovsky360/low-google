#!/usr/bin/env bash
set -euo pipefail

INPUT_PROJECT="${1:-${GOOGLE_CLOUD_PROJECT:-low-agent}}"
REGION="${2:-${GOOGLE_CLOUD_REGION:-us-central1}}"
SERVICE_NAME="low-web"

if [[ -z "$INPUT_PROJECT" ]]; then
  echo "Usage: ./scripts/deploy-cloud-run.sh <PROJECT_ID_OR_NUMBER> [REGION]"
  exit 1
fi

if [[ "$INPUT_PROJECT" =~ ^[0-9]+$ ]]; then
  echo "==> Resolving Project ID for Project Number: $INPUT_PROJECT..."
  PROJECT_ID="$(gcloud projects describe "$INPUT_PROJECT" --format='value(projectId)')"
else
  PROJECT_ID="$INPUT_PROJECT"
fi

PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
COMPUTE_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

echo "==> Configuring Google Cloud project: $PROJECT_ID (number: $PROJECT_NUMBER, region: $REGION)"
gcloud config set project "$PROJECT_ID"

echo "==> Enabling required Google Cloud APIs..."
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  storage.googleapis.com \
  firestore.googleapis.com \
  cloudkms.googleapis.com \
  secretmanager.googleapis.com \
  aiplatform.googleapis.com

echo "==> Granting Cloud Build / Cloud Run source build IAM roles to $COMPUTE_SA..."
for ROLE in \
  roles/storage.admin \
  roles/artifactregistry.writer \
  roles/logging.logWriter \
  roles/cloudbuild.builds.builder \
  roles/run.builder; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${COMPUTE_SA}" \
    --role="$ROLE" \
    --quiet >/dev/null
done

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
