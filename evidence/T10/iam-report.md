# Evidencia de mínimo privilegio — stack `donations-academic`

Generado: 2026-11-12T14:58:29.260Z con `npm run evidence:iam` (solo lectura).

## T10: la función de listado no puede escribir (IAM Policy Simulator)

| Acción | Recurso | Decisión |
| --- | --- | --- |
| `dynamodb:Query` | `table/donations-academic-ProjectsTable-12XZ7A20A9TYB/index/status-createdAt` | allowed |
| `dynamodb:PutItem` | `table/donations-academic-ProjectsTable-12XZ7A20A9TYB` | implicitDeny |
| `dynamodb:UpdateItem` | `table/donations-academic-ProjectsTable-12XZ7A20A9TYB` | implicitDeny |
| `dynamodb:DeleteItem` | `table/donations-academic-ProjectsTable-12XZ7A20A9TYB` | implicitDeny |
| `dynamodb:BatchWriteItem` | `table/donations-academic-ProjectsTable-12XZ7A20A9TYB` | implicitDeny |
| `dynamodb:Scan` | `table/donations-academic-ProjectsTable-12XZ7A20A9TYB` | implicitDeny |
| `dynamodb:GetItem` | `table/donations-academic-DonationsTable-ACBT42H84E2O` | implicitDeny |

## Escrituras permitidas por rol y tabla

Cada celda indica las acciones de escritura que el simulador permite (— = ninguna).

| Rol | AuditEventsTable | DonationsTable | IdempotencyTable | ProjectsTable |
| --- | --- | --- | --- | --- |
| CreateDonationRole | PutItem | PutItem | PutItem | — |
| CreateProjectRole | PutItem | — | — | PutItem |
| GetDonationRole | — | — | — | — |
| GetMyDonationsRole | — | — | — | — |
| GetProjectRole | — | — | — | — |
| GetProjectStatsRole | — | — | — | — |
| ListManagedProjectsRole | — | — | — | — |
| ListProjectsRole | — | — | — | — |
| PreTokenGenerationRole | — | — | — | — |
| PublishProjectRole | PutItem | — | — | UpdateItem |
| SimulateDonationRole | PutItem | UpdateItem | — | UpdateItem |
| UpdateProjectRole | PutItem | — | — | UpdateItem |

## IAM Access Analyzer (`ValidatePolicy`) y comodines

| Rol | Política | Hallazgos de Access Analyzer | Comodines |
| --- | --- | --- | --- |
| CreateDonationRole | check-published-project | ninguno | — |
| CreateDonationRole | create-donation | ninguno | — |
| CreateDonationRole | idempotency-records | ninguno | — |
| CreateDonationRole | write-audit-events | ninguno | — |
| CreateDonationRole | write-own-logs | ninguno | `arn:aws:logs:us-east-2:<cuenta>:log-group:/aws/lambda/donations-academic-create-donation:*` |
| CreateProjectRole | put-project | ninguno | — |
| CreateProjectRole | write-audit-events | ninguno | — |
| CreateProjectRole | write-own-logs | ninguno | `arn:aws:logs:us-east-2:<cuenta>:log-group:/aws/lambda/donations-academic-create-project:*` |
| GetDonationRole | get-donation | ninguno | — |
| GetDonationRole | write-own-logs | ninguno | `arn:aws:logs:us-east-2:<cuenta>:log-group:/aws/lambda/donations-academic-get-donation:*` |
| GetMyDonationsRole | query-own-donations | ninguno | — |
| GetMyDonationsRole | write-own-logs | ninguno | `arn:aws:logs:us-east-2:<cuenta>:log-group:/aws/lambda/donations-academic-get-my-donations:*` |
| GetProjectRole | get-project | ninguno | — |
| GetProjectRole | write-own-logs | ninguno | `arn:aws:logs:us-east-2:<cuenta>:log-group:/aws/lambda/donations-academic-get-project:*` |
| GetProjectStatsRole | get-project | ninguno | — |
| GetProjectStatsRole | write-own-logs | ninguno | `arn:aws:logs:us-east-2:<cuenta>:log-group:/aws/lambda/donations-academic-get-project-stats:*` |
| ListManagedProjectsRole | query-all-projects | ninguno | — |
| ListManagedProjectsRole | write-own-logs | ninguno | `arn:aws:logs:us-east-2:<cuenta>:log-group:/aws/lambda/donations-academic-list-managed-projects:*` |
| ListProjectsRole | query-published-projects | ninguno | — |
| ListProjectsRole | write-own-logs | ninguno | `arn:aws:logs:us-east-2:<cuenta>:log-group:/aws/lambda/donations-academic-list-projects:*` |
| PreTokenGenerationRole | read-user-mfa-settings | ninguno | `arn:aws:cognito-idp:us-east-2:<cuenta>:userpool/*` |
| PreTokenGenerationRole | write-own-logs | ninguno | `arn:aws:logs:us-east-2:<cuenta>:log-group:/aws/lambda/donations-academic-pre-token-generation:*` |
| PublishProjectRole | publish-project | ninguno | — |
| PublishProjectRole | write-audit-events | ninguno | — |
| PublishProjectRole | write-own-logs | ninguno | `arn:aws:logs:us-east-2:<cuenta>:log-group:/aws/lambda/donations-academic-publish-project:*` |
| SimulateDonationRole | add-confirmed-amount | ninguno | — |
| SimulateDonationRole | simulate-donation | ninguno | — |
| SimulateDonationRole | write-audit-events | ninguno | — |
| SimulateDonationRole | write-own-logs | ninguno | `arn:aws:logs:us-east-2:<cuenta>:log-group:/aws/lambda/donations-academic-simulate-donation:*` |
| UpdateProjectRole | update-project | ninguno | — |
| UpdateProjectRole | write-audit-events | ninguno | — |
| UpdateProjectRole | write-own-logs | ninguno | `arn:aws:logs:us-east-2:<cuenta>:log-group:/aws/lambda/donations-academic-update-project:*` |

Políticas administradas adjuntas a los roles: 0.
