# Independent KUNDE Maps DEV infrastructure. No shared KUNDE state or databases.
# Render serves the preview shell; Neon holds future geocoding/place metadata.
# Tiles are NOT present until a separate PMTiles hosting pipeline is provisioned.
resource "neon_project" "maps" {
  name                      = var.neon_project_name
  org_id                    = var.neon_org_id
  region_id                 = "aws-eu-central-1"
  pg_version                = 16
  history_retention_seconds = 21600
  branch {
    name          = "main"
    database_name = "kunde_maps"
    role_name     = "kunde_maps_owner"
  }
}

resource "render_web_service" "maps" {
  name              = var.render_service_name
  plan              = "free"
  region            = "frankfurt"
  health_check_path = "/"
  runtime_source = {
    docker = {
      repo_url            = "https://github.com/ADatkashov/kunde-maps"
      branch              = var.branch
      dockerfile_path     = "./infrastructure/maps/Dockerfile"
      context             = "."
      auto_deploy_trigger = "off"
    }
  }
  env_vars = {
    PORT = { value = "80" }
  }
}
