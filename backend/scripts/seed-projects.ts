/**
 * Carga los proyectos ficticios de src/projects/seed.ts en la tabla `Projects` desplegada.
 * Lo ejecuta una persona del equipo después de `sam deploy` (design.md §10):
 *
 *   aws login --region us-east-2 --profile donations-dev
 *   PROJECTS_TABLE=<ProjectsTableName> npm run seed:projects
 *
 * Usa las credenciales temporales del perfil (`AWS_PROFILE`). Es idempotente: no
 * sobrescribe un proyecto que ya exista.
 */
import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { SEED_PROJECTS } from '../src/projects/seed.ts';

const tableName = process.env.PROJECTS_TABLE?.trim();
if (!tableName) {
  console.error('Define PROJECTS_TABLE con el valor de la salida ProjectsTableName de la pila.');
  process.exit(1);
}

const client = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: process.env.AWS_REGION ?? 'us-east-2' }),
);

let created = 0;
let skipped = 0;
for (const project of SEED_PROJECTS) {
  try {
    await client.send(
      new PutCommand({
        TableName: tableName,
        Item: project,
        ConditionExpression: 'attribute_not_exists(projectId)',
      }),
    );
    created += 1;
    console.log(`creado    ${project.projectId}  ${project.status}  ${project.title}`);
  } catch (error) {
    if (!(error instanceof ConditionalCheckFailedException)) throw error;
    skipped += 1;
    console.log(`ya existe ${project.projectId}`);
  }
}

console.log(`\n${String(created)} creados, ${String(skipped)} ya existían en ${tableName}.`);
