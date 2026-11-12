// HU-07 y HU-04 (CA-04.2, T12): solo el DONANTE, con el scope api/donations.read, consulta su
// historial. Un GESTOR o un AUDITOR recibe 403.
permit (
  principal in Donations::Role::"DONANTE",
  action == Donations::Action::"ReadOwnDonations",
  resource == Donations::Platform::"donations"
)
when { context.scopes.contains("api/donations.read") };
