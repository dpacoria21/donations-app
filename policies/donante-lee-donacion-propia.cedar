// HU-07 (CA-07.2, T09): un DONANTE solo lee una donación si es su propietario. El propietario
// sale del registro guardado en DynamoDB, nunca del cliente. Si se deniega, el API responde 404,
// igual que para una donación inexistente, para no revelar que existe.
permit (
  principal in Donations::Role::"DONANTE",
  action == Donations::Action::"ReadDonation",
  resource
)
when { resource.owner == principal && context.scopes.contains("api/donations.read") };
