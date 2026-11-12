// Páginas de prueba del backend (solo desarrollo local). Todo el contenido del API
// se inserta con textContent, nunca como HTML.

const pen = new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' });
const formatCents = (cents) => pen.format(cents / 100);

async function getJson(url) {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  const body = await response.json().catch(() => null);
  return { url, status: response.status, body };
}

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

async function renderCatalog() {
  const status = document.getElementById('estado');
  const list = document.getElementById('lista-proyectos');
  try {
    const { status: code, body } = await getJson('/v1/projects');
    if (code !== 200) {
      status.textContent = `No se pudo cargar el catálogo (HTTP ${code}).`;
      return;
    }
    if (body.items.length === 0) {
      status.textContent = 'Todavía no hay proyectos publicados.';
      return;
    }
    status.textContent = `${body.items.length} proyectos publicados.`;
    for (const project of body.items) {
      const item = element('li', undefined, 'project-card');
      const title = element('h2');
      const link = element('a', project.title);
      link.href = `/proyecto.html?id=${encodeURIComponent(project.projectId)}`;
      title.append(link);

      const progress = document.createElement('progress');
      progress.max = project.goalAmountCents;
      progress.value = project.confirmedAmountCents;
      progress.setAttribute('aria-label', `Avance de ${project.title}`);

      item.append(
        title,
        element('p', project.description),
        progress,
        element(
          'p',
          `${formatCents(project.confirmedAmountCents)} confirmados de ${formatCents(project.goalAmountCents)}`,
          'amounts',
        ),
      );
      list.append(item);
    }
  } catch {
    status.textContent = 'No se pudo conectar con el backend.';
  }
}

async function renderDetail() {
  const status = document.getElementById('estado');
  const raw = document.getElementById('respuestas');
  const projectId = new URLSearchParams(location.search).get('id');
  if (!projectId) {
    status.textContent = 'Falta el parámetro «id» en la URL.';
    return;
  }

  try {
    const id = encodeURIComponent(projectId);
    const [detail, stats] = await Promise.all([
      getJson(`/v1/projects/${id}`),
      getJson(`/v1/projects/${id}/stats`),
    ]);
    raw.textContent = JSON.stringify([detail, stats], null, 2);

    if (detail.status === 404) {
      status.textContent = 'Proyecto no encontrado (HTTP 404).';
      return;
    }
    if (detail.status !== 200 || stats.status !== 200) {
      status.textContent = `No se pudo cargar el proyecto (HTTP ${detail.status}).`;
      return;
    }

    const project = detail.body;
    document.title = `${project.title} · Fundación AQP-SOLIDARIA`;
    document.getElementById('titulo').textContent = project.title;
    document.getElementById('descripcion').textContent = project.description;
    document.getElementById('avance').value = stats.body.progressPercent;
    document.getElementById('avance-texto').textContent = `${stats.body.progressPercent} %`;
    document.getElementById('recaudado').textContent = formatCents(stats.body.confirmedAmountCents);
    document.getElementById('meta').textContent = formatCents(stats.body.goalAmountCents);
    document.getElementById('estado-proyecto').textContent = project.status;
    document.getElementById('identificador').textContent = project.projectId;
    document.getElementById('detalle').hidden = false;
    status.textContent = '';
  } catch {
    status.textContent = 'No se pudo conectar con el backend.';
  }
}

const page = document.body.dataset.page;
if (page === 'catalogo') void renderCatalog();
if (page === 'detalle') void renderDetail();
