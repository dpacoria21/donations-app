/**
 * Evidencia de T08 (CA-06.2, CA-NF04.1) contra el stage desplegado: envía 10 confirmaciones
 * simultáneas de la misma donación y comprueba que el acumulado del proyecto sube una sola vez.
 *
 *   API_URL=<ApiUrl> ACCESS_TOKEN=<access token de un DONANTE> DONATION_ID=<pendiente> \
 *     node scripts/t08-concurrency.ts
 *
 * El access token se obtiene con el login de Postman o del frontend; dura 15 minutos y no se
 * guarda en ningún archivo. La donación debe ser propia y estar PENDIENTE_SIMULACION.
 */
const apiUrl = process.env.API_URL?.replace(/\/+$/, '');
const token = process.env.ACCESS_TOKEN;
const donationId = process.env.DONATION_ID;
if (!apiUrl || !token || !donationId) {
  console.error('Faltan API_URL, ACCESS_TOKEN o DONATION_ID.');
  process.exit(1);
}

const authorization = { authorization: `Bearer ${token}` };

interface Donation {
  projectId: string;
  amountCents: number;
  status: string;
}

async function confirmedOf(projectId: string): Promise<number> {
  const response = await fetch(`${String(apiUrl)}/v1/projects/${projectId}/stats`);
  const stats = (await response.json()) as { confirmedAmountCents: number };
  return stats.confirmedAmountCents;
}

const donationResponse = await fetch(`${apiUrl}/v1/donations/${donationId}`, {
  headers: authorization,
});
if (!donationResponse.ok) {
  console.error(`No se pudo leer la donación: HTTP ${String(donationResponse.status)}`);
  process.exit(1);
}
const donation = (await donationResponse.json()) as Donation;
if (donation.status !== 'PENDIENTE_SIMULACION') {
  console.error(`La donación ya está ${donation.status}; crea otra para repetir la prueba.`);
  process.exit(1);
}

const before = await confirmedOf(donation.projectId);
const statuses = await Promise.all(
  Array.from({ length: 10 }, () =>
    fetch(`${apiUrl}/v1/donations/${donationId}/simulate`, {
      method: 'POST',
      headers: { ...authorization, 'content-type': 'application/json' },
      body: JSON.stringify({ outcome: 'CONFIRMADA_SIMULADA' }),
    }).then((response) => response.status),
  ),
);
const after = await confirmedOf(donation.projectId);

const count = (code: number) => statuses.filter((status) => status === code).length;
console.log(`Respuestas: ${String(count(200))} × 200, ${String(count(409))} × 409`);
console.log(`Acumulado: ${String(before)} → ${String(after)} céntimos`);
console.log(`Monto de la donación: ${String(donation.amountCents)} céntimos`);

const passed = count(200) === 1 && count(409) === 9 && after - before === donation.amountCents;
console.log(passed ? 'T08 OK: un solo incremento.' : 'T08 FALLÓ.');
process.exit(passed ? 0 : 1);
