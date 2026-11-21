variable "neon_org_id" {
  type = string
  default = null
  description = "Neon organization ID, supplied via TF_VAR_neon_org_id."
}
variable "neon_project_name" {
  type = string
  default = "kunde-maps-dev"
}
variable "render_service_name" {
  type = string
  default = "kunde-maps-web-dev"
}
variable "branch" {
  type = string
  default = "main"
}
