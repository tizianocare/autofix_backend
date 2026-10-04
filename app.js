// Tarea 3: Conectar con el backend y obtener la lista de OTs
async function obtenerYMostrarOrdenes() {
  try {
    // 1. Petición GET al backend
    const respuesta = await fetch('http://localhost:3000/api/ordenes-trabajo');
    if (!respuesta.ok) {
      throw new Error('Error al obtener los datos del servidor');
    }
    const ordenes = await respuesta.json();

    // 2. Renderizar los datos clave en la tabla (Tarea 2)
    renderizarOrdenes(ordenes);
  } catch (error) {
    console.error('Error de conexión:', error);
    const tbody = document.getElementById('tabla-ordenes');
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; color: #e74c3c; padding: 20px;">
          ❌ No se pudo conectar con el servidor. Asegúrate de que "node index.js" esté corriendo.
        </td>
      </tr>
    `;
  }
}

// Función que renderiza las filas (Tarea 2)
function renderizarOrdenes(ordenes) {
  const tbody = document.getElementById('tabla-ordenes');
  tbody.innerHTML = '';

  if (!ordenes || ordenes.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; padding: 20px; color: #7f8c8d;">
          No hay órdenes de trabajo activas en este momento.
        </td>
      </tr>
    `;
    return;
  }

  ordenes.forEach(ot => {
    const fila = document.createElement('tr');

    const patenteFormat = `<span class="patente-tag">${ot.patente}</span>`;
    const vehiculoFormat = `${ot.marca} ${ot.modelo}`;
    const clienteFormat = `${ot.cliente}<br><small style="color: #7f8c8d;">${ot.telefono}</small>`;
    const estadoFormat = `<span class="estado-badge estado-${(ot.estado || 'INGRESADO').toLowerCase()}">${ot.estado || 'INGRESADO'}</span>`;

    fila.innerHTML = `
      <td><strong>${ot.numero_ot}</strong></td>
      <td>${patenteFormat}</td>
      <td>${vehiculoFormat}</td>
      <td>${clienteFormat}</td>
      <td>${ot.fallas_reportadas || 'Sin observaciones'}</td>
      <td>${estadoFormat}</td>
    `;

    tbody.appendChild(fila);
  });
}

// Cargar la lista automáticamente al abrir la página
document.addEventListener('DOMContentLoaded', obtenerYMostrarOrdenes);