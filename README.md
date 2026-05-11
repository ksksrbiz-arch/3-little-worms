<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/f96da052-6138-454f-acf9-c6d6ed39f62d

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Deployment (Google Cloud Run)

This repository is configured to deploy to **Google Cloud Run** from GitHub Actions.

- Workflow: `.github/workflows/deploy-google-cloud.yml`
- Every push runs lint + build
- Pushes to the default branch also deploy to Cloud Run

### Required GitHub repository variables

- `GCP_PROJECT_ID` (your Google Cloud project ID)
- `GCP_REGION` (example: `us-west2`)
- `CLOUD_RUN_SERVICE` (Cloud Run service name)

### Required GitHub repository secrets

- `GCP_WORKLOAD_IDENTITY_PROVIDER`
- `GCP_SERVICE_ACCOUNT`

No Cloudflare deployment configuration is used by this repository.
