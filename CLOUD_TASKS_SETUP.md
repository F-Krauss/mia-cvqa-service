# Cloud Tasks Integration Setup Guide

This guide explains how to configure and deploy the Cloud Tasks integration for document indexing in the MIA AI Service.

## Overview

The Cloud Tasks integration provides a reliable, scalable way to process document indexing asynchronously:

- **Reliability**: Cloud Tasks automatically retries failed tasks up to 100 times over 7 days
- **Scalability**: Handles high-volume document uploads without blocking the API
- **Persistence**: Tasks are persisted in Google Cloud, surviving service restarts
- **Monitoring**: Full visibility into task status through Google Cloud Console

## Architecture

```
User Upload Document
        ↓
Documents Controller
        ↓
DocumentsService.create()
        ↓
Cloud Tasks Queue
        ↓
Cloud Run Task Handler (POST /tasks/index-document)
        ↓
DocumentAiAnalyzerService.analyzeDocument()
        ↓
VectorStoreService.indexDocument()
        ↓
Supabase pgvector (mia-document-vectors)
```

## Prerequisites

1. **Google Cloud Project** with Cloud Tasks API enabled
2. **Cloud Run** service deployed (the handler runs on Cloud Run)
3. **Supabase** project with pgvector extension enabled
4. **Service Account** with appropriate IAM roles

## Step 1: Enable Cloud Tasks API

```bash
gcloud services enable cloudtasks.googleapis.com --project=YOUR_PROJECT_ID
```

## Step 2: Create a Cloud Tasks Queue

Create a queue for document indexing tasks:

```bash
gcloud tasks queues create document-indexing \
  --location=us-central1 \
  --project=YOUR_PROJECT_ID
```

**Available Regions:**
- us-central1 (default, recommended)
- us-east1
- us-west1
- europe-west1
- asia-northeast1
- asia-southeast1

## Step 3: Set up Service Account with Proper IAM Roles

The Cloud Run service needs a service account with permissions to:
1. Create tasks in Cloud Tasks
2. Call Cloud Run endpoints with OIDC tokens

### Create or select a service account:

```bash
# List existing service accounts
gcloud iam service-accounts list --project=YOUR_PROJECT_ID

# Or create a new one
gcloud iam service-accounts create mia-ai-service \
  --display-name="MIA AI Service" \
  --project=YOUR_PROJECT_ID
```

### Grant Cloud Tasks permissions:

```bash
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:mia-ai-service@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/cloudtasks.enqueuer"
```

### Grant Cloud Run invoke permissions:

The service account needs to invoke Cloud Run endpoints with OIDC tokens:

```bash
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:mia-ai-service@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/run.invoker"
```

### Deploy Cloud Run with service account:

```bash
gcloud run deploy mia-ai-service \
  --service-account=mia-ai-service@YOUR_PROJECT_ID.iam.gserviceaccount.com \
  --project=YOUR_PROJECT_ID
```

## Step 4: Configure Environment Variables

Set these environment variables in your Cloud Run deployment:

```bash
# Required for Cloud Tasks
GOOGLE_CLOUD_PROJECT=YOUR_PROJECT_ID
CLOUD_TASKS_QUEUE=document-indexing
CLOUD_TASKS_LOCATION=us-central1
CLOUD_TASKS_HANDLER_URL=https://mia-ai-service-YOUR-ID.run.app

# Existing variables
VERTEX_PROJECT_ID=YOUR_PROJECT_ID
FIREBASE_PROJECT_ID=YOUR_PROJECT_ID
GCS_STORAGE_BUCKET=mia-docs-prod
SUPABASE_URL=your-supabase-url
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_KEY=your-service-key
```

## Step 5: Deploy Cloud Run Service

```bash
gcloud run deploy mia-ai-service \
  --source . \
  --platform managed \
  --region us-central1 \
  --project YOUR_PROJECT_ID \
  --set-env-vars="GOOGLE_CLOUD_PROJECT=YOUR_PROJECT_ID,CLOUD_TASKS_QUEUE=document-indexing,CLOUD_TASKS_LOCATION=us-central1,CLOUD_TASKS_HANDLER_URL=https://mia-ai-service-YOUR-ID.run.app" \
  --service-account=mia-ai-service@YOUR_PROJECT_ID.iam.gserviceaccount.com \
  --allow-unauthenticated
```

## Step 6: Test Cloud Tasks Integration

### 1. Verify Task Handler is Accessible

```bash
curl -X POST https://mia-ai-service-YOUR-ID.run.app/tasks/health \
  -H "Content-Type: application/json"

# Expected response:
# {"status":"ok","timestamp":"2024-01-15T10:30:45.123Z"}
```

### 2. Upload a Test Document

Upload a document via the API with `ragEnabled: true`:

```bash
curl -X POST https://your-api-url/api/documents/upload \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@test.pdf" \
  -F "ragEnabled=true"
```

### 3. Monitor Task Queue

```bash
# List tasks in the queue
gcloud tasks list --queue=document-indexing --location=us-central1

# Get details of a specific task
gcloud tasks describe TASK_ID \
  --queue=document-indexing \
  --location=us-central1
```

### 4. Check Cloud Run Logs

```bash
gcloud run logs read mia-ai-service \
  --region=us-central1 \
  --limit=50
```

### 5. Verify Vector Storage in Supabase

Check if vectors were indexed correctly:

```sql
-- Supabase SQL Console
SELECT 
  dc.id,
  dc.content,
  dc.embedding IS NOT NULL as has_embedding,
  dc.created_at
FROM mia_document_chunks dc
ORDER BY dc.created_at DESC
LIMIT 10;
```

## Cloud Tasks Retry Configuration

Cloud Tasks automatically retries failed tasks with exponential backoff:

- **First Retry**: 1-2 seconds
- **Max Retries**: 100 times
- **Max Age**: 7 days
- **Backoff**: Exponential with random jitter

You can adjust these in the Cloud Tasks queue configuration:

```bash
gcloud tasks queues update document-indexing \
  --location=us-central1 \
  --max-attempts=50 \
  --max-backoff=600 \
  --min-backoff=1
```

## Monitoring and Debugging

### View Task Execution Logs

Cloud Tasks logs go to Cloud Logging. Filter by:

```
resource.type = "cloud_tasks_queue"
resource.labels.queue_name = "document-indexing"
```

### Check Document Embedding Status

```sql
-- In Supabase
SELECT id, embedding_status, embedding_processed_at, updated_at
FROM documents
WHERE rag_enabled = true
ORDER BY updated_at DESC;
```

### Troubleshoot Failed Tasks

**Issue**: Tasks failing with 403 Unauthorized
- **Solution**: Ensure service account has `roles/run.invoker` permission

**Issue**: Tasks timing out
- **Solution**: Cloud Tasks has a 30-minute timeout. For longer operations, consider:
  - Breaking documents into smaller chunks
  - Implementing progress tracking
  - Using Pub/Sub for even larger workloads

**Issue**: Tasks not being created
- **Solution**: Verify:
  - `CLOUD_TASKS_HANDLER_URL` is correct and public
  - Service account has `roles/cloudtasks.enqueuer` role
  - Queue exists in specified location

## Fallback Behavior

If Cloud Tasks is not configured or unavailable:

1. The service checks `cloudTasks.isAvailable()`
2. If not available, falls back to immediate processing using `setImmediate()`
3. This allows graceful degradation while maintaining functionality

```typescript
if (metadata.ragEnabled) {
  if (this.cloudTasks.isAvailable()) {
    // Queue to Cloud Tasks
    await this.cloudTasks.queueDocumentIndexing(documentId, organizationId);
  } else {
    // Fallback to immediate processing
    this.aiAnalyzer.analyzeDocument(documentId, file.buffer);
  }
}
```

## Security Considerations

1. **OIDC Authentication**: Cloud Tasks uses OIDC tokens for Cloud Run authentication
   - No API keys exposed in Cloud Tasks
   - Automatic token rotation by Google Cloud

2. **Service Account Isolation**:
   - Use dedicated service account for Cloud Run
   - Apply least-privilege principle with minimal IAM roles

3. **Network Security**:
   - Cloud Run is private by default
   - OIDC token ensures only authenticated Cloud Tasks can invoke it

4. **Data Encryption**:
   - Vectors stored in Supabase with pgvector
   - Use Supabase SSL connections (enabled by default)
   - Consider row-level security (RLS) policies

## Cost Optimization

Cloud Tasks pricing:
- **Free tier**: 1 million operations per month
- **Paid**: $0.40 per million operations after free tier

Tips for cost optimization:
1. Use document chunk size limits to reduce operations
2. Batch small documents together
3. Monitor task success rate (minimize retries)
4. Archive old documents instead of keeping them indexed

## Production Checklist

- [ ] Cloud Tasks API enabled in GCP
- [ ] Document indexing queue created
- [ ] Service account created with proper roles
- [ ] Environment variables configured
- [ ] Cloud Run deployed with updated code
- [ ] Test document upload completes successfully
- [ ] Vectors appear in Supabase within 2 minutes
- [ ] Cloud Run logs show task handler being called
- [ ] No errors in embedding status for test documents
- [ ] Monitor Cloud Tasks queue for failed tasks

## Next Steps

1. **Index Existing Documents**: Consider indexing documents that were uploaded before Cloud Tasks was enabled:

```typescript
// Script to reindex documents
const docsToIndex = await prisma.documentFile.findMany({
  where: {
    ragEnabled: true,
    embeddingStatus: { in: ['pending', 'failed'] },
  },
});

for (const doc of docsToIndex) {
  await cloudTasksService.queueDocumentIndexing(doc.id, doc.organizationId);
}
```

2. **Implement Progress Tracking**: Add webhook support to track document indexing progress in real-time

3. **Set up Monitoring Alerts**: Create alerts for:
   - High task failure rates
   - Queue depth increasing
   - Handler latency increasing

## References

- [Google Cloud Tasks Documentation](https://cloud.google.com/tasks/docs)
- [Cloud Run Documentation](https://cloud.google.com/run/docs)
- [Supabase pgvector Documentation](https://supabase.com/docs/guides/database/pgvector)
