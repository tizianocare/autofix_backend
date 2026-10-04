// Tarea 2: Renderizar los datos clave de cada OT en la tabla
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

    // Mapeo explícito de los datos clave requeridos
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