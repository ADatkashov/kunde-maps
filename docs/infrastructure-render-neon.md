# KUNDE Maps DEV: Render + Neon + Terraform

Adapted from the **separate** ADatkashov/kunde DEV Terraform layout, with pinned providers Render 1.9.1 and Neon 0.18.0. No KUNDE state, service, or database is reused.

- Render: new free-tier Docker web service `kunde-maps-web-dev` from this repository.
- Neon: new PostgreSQL 16 project `kunde-maps-dev`, Frankfurt, 6-hour PITR, with dedicated database.
- Terraform: independent HCP Terraform workspace (suggested `kunde-maps-dev`), local execution mode, state isolated from `kunde-dev`.
- No production data, no paid resources, no implicit apply.

## Provisioning

1. Create/select **a separate** HCP Terraform workspace for KUNDE Maps, local execution.
2. Provide `TF_CLOUD_ORGANIZATION`, `TF_WORKSPACE`, `TF_TOKEN_app_terraform_io`, `RENDER_API_KEY`, `RENDER_OWNER_ID`, `NEON_API_KEY` and `TF_VAR_neon_org_id` through secure CI/environment secrets. Never copy secret values from KUNDE.
3. Run `terraform -chdir=infrastructure/terraform/environments/dev init`, `validate`, then `plan -out=maps.tfplan`.
4. Review plan for **exactly one new Render free web service and one new Neon project**, no deletions and no paid changes.
5. Apply only after the owner has approved the plan and target Render workspace. Do not import or modify existing KUNDE resources.

**Known limitation:** Render serves a preview shell, not a full map: PMTiles have not been generated or uploaded. The current style references localhost and must be switched to an authorized HTTPS tile host before remote map rendering. Neon is provisioned for future geocoding/places; the current static web service does not use it. Render free tier may consume shared workspace instance-hours. Review the plan and quotas before apply.
