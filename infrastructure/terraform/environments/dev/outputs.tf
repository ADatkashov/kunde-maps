output "render_url" {
  value = render_web_service.maps.url
}
output "neon_host" {
  value = neon_project.maps.database_host
}
output "neon_database" {
  value = neon_project.maps.database_name
}
output "neon_username" {
  value = neon_project.maps.database_user
}
