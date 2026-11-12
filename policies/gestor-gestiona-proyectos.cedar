// HU-04 y HU-08 (CA-04.1, CA-08.1, CA-08.2): solo el GESTOR, con el scope api/projects.write,
// lista, crea, edita y publica proyectos. Un DONANTE o un AUDITOR no coincide con ninguna
// política y Cedar deniega por defecto (403).
permit (
  principal in Donations::Role::"GESTOR",
  action in [
    Donations::Action::"ListManagedProjects",
    Donations::Action::"CreateProject",
    Donations::Action::"UpdateProject",
    Donations::Action::"PublishProject"
  ],
  resource
)
when { context.scopes.contains("api/projects.write") };
