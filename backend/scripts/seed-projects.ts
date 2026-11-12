/**
 * Carga los proyectos ficticios de src/projects/seed.ts en la tabla `Projects` desplegada.
 * Lo ejecuta una persona del equipo después de `sam deploy` (design.md §10):
 *
 *   aws login --region us-east-2 --profile donations-dev
 *   PROJECTS_TABLE=<ProjectsTableName> npm run seed:projects
 *
 * Usa las credenciales temporales del perfil (`AWS_PROFILE`). Es idempotente: no
 * sobrescribe un proyecto que ya exista.
 *
 * Prueba de rendimiento (CA-NF05.1, 50 proyectos):
 *
 *   npm run seed:projects -- --load          # añade 50 proyectos PUBLICADO «Carga NN»
 *   npm run seed:projects -- --remove-load   # los borra al terminar de medir
 *
 * Los proyectos de carga tienen IDs fijos (`10ad0000-…`) para borrarlos sin tocar los demás.
 */
import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { Project } from '../src/projects/model.ts';
import { SEED_PROJECTS } from '../src/projects/seed.ts';

export const LOAD_PROJECT_COUNT = 50;

/** Proyectos PUBLICADO para la prueba de rendimiento, con IDs reconocibles. */
export function loadProjects(count = LOAD_PROJECT_COUNT): Project[] {
  return Array.from({ length: count }, (_, index) => {
    const n = String(index + 1).padStart(2, '0');
    const createdAt = new Date(Date.UTC(2026, 9, 1, 12, index)).toISOString();
    return {
      projectId: `10ad0000-0000-4000-8000-0000000000${n}`,
      title: `Proyecto de carga ${n}`,
      description: 'Proyecto ficticio para medir el rendimiento del catálogo (CA-NF05.1).',
      goalAmountCents: 100_000 * (index + 1),
      confirmedAmountCents: 0,
      currency: 'PEN',
      status: 'PUBLICADO',
      createdAt,
      updatedAt: createdAt,
    };
  });
}

const tableName = process.env.PROJECTS_TABLE?.trim();
if (!tableName) {
  console.error('Define PROJECTS_TABLE con el valor de la salida ProjectsTableName de la pila.');
  process.exit(1);
}

const client = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: process.env.AWS_REGION ?? 'us-east-2' }),
);
const mode = process.argv.includes('--remove-load')
  ? 'remove'
  : process.argv.includes('--load')
    ? 'load'
    : 'seed';

if (mode === 'remove') {
  for (const project of loadProjects()) {
    await client.send(
      new DeleteCommand({ TableName: tableName, Key: { projectId: project.projectId } }),
    );
  }
  console.log(`${String(LOAD_PROJECT_COUNT)} proyectos de carga borrados de ${tableName}.`);
} else {
  let created = 0;
  let skipped = 0;
  for (const project of mode === 'load' ? loadProjects() : SEED_PROJECTS) {
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
}
