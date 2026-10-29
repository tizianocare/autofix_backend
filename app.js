const API_URL = 'http://localhost:3000/api/ordenes-trabajo';

// Listas globales
let ordenesCargadas = [];
let mecanicosCargados = [];
let otSeleccionada = null;

// Siguiente estado del flujo (debe coincidir con TRANSICIONES_PERMITIDAS de index.js)
const SIGUIENTE_ESTADO = {
  INGRESADO: 'DIAGNOSTICO',
  DIAGNOSTICO: 'PRESUPUESTADO',
  PRESUPUESTADO: 'EN_REPARACION',
  EN_REPARACION: 'LISTO'
  // LISTO -> ENTREGADO no está acá: se hace con "Registrar entrega" (Tarjeta 3.4)
};

// Estados desde los que se puede cancelar (igual que TRANSICIONES_PERMITIDAS de index.js)
const PUEDE_CANCELAR = ['INGRESADO', 'DIAGNOSTICO', 'PRESUPUESTADO', 'EN_REPARACION'];

const formatoMoneda = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });

function formatearFecha(valor) {
  if (!valor) return '';
  return new Date(valor).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
}

// Función para sanitizar HTML (XSS)
function escapeHtml(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ---------------------------------------------------------------
// 1. Cargar la lista de Mecánicos (para los selectores)
// ---------------------------------------------------------------
async function cargarMecanicos() {
  try {
    const respuesta = await fetch('http://localhost:3000/api/mecanicos');
    if (respuesta.ok) {
      mecanicosCargados = await respuesta.json();
      poblarFiltroMecanicos();
    }
  } catch (error) {
    console.error('Error al cargar mecánicos:', error);
  }
}

function poblarFiltroMecanicos() {
  const selectFiltro = document.getElementById('filtro-mecanico');
  if (!selectFiltro) return;

  selectFiltro.innerHTML = '<option value="">Todos los mecánicos</option>';
  mecanicosCargados.forEach((m) => {
    selectFiltro.innerHTML += `<option value="${m.id}">${escapeHtml(m.nombre)}</option>`;
  });
}

// ---------------------------------------------------------------
// 2. Asignar Mecánico a una OT (PATCH)
// ---------------------------------------------------------------
async function cambiarMecanico(numero_ot, mecanico_id) {
  try {
    const respuesta = await fetch(`${API_URL}/${encodeURIComponent(numero_ot)}/mecanico`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mecanico_id: mecanico_id || null })
    });

    const resultado = await respuesta.json();

    if (respuesta.ok) {
      alert(resultado.mensaje);
      obtenerYMostrarOrdenes(); // Refrescar la tabla
    } else {
      alert(`Error: ${resultado.error}`);
    }
  } catch (error) {
    console.error('Error al asignar mecánico:', error);
    alert('No se pudo conectar con el servidor.');
  }
}

// ---------------------------------------------------------------
// 3. Cambiar Estado de una OT (PATCH)
// ---------------------------------------------------------------
async function cambiarEstado(numero_ot, nuevo_estado) {
  if (!confirm(`¿Confirmás cambiar el estado de la OT ${numero_ot} a ${nuevo_estado}?`)) return;

  try {
    const respuesta = await fetch(`${API_URL}/${encodeURIComponent(numero_ot)}/estado`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nuevo_estado })
    });

    const resultado = await respuesta.json();

    if (respuesta.ok) {
      alert(resultado.mensaje);
      obtenerYMostrarOrdenes();
    } else {
      alert(`Error: ${resultado.error}`);
    }
  } catch (error) {
    console.error('Error al cambiar el estado:', error);
    alert('No se pudo conectar con el servidor.');
  }
}

// ---------------------------------------------------------------
// 4. Obtener y Mostrar Órdenes (con Filtros por Estado y Mecánico)
// ---------------------------------------------------------------
async function obtenerYMostrarOrdenes() {
  const filtroEstado = document.getElementById('filtro-estado')?.value || '';
  const filtroMecanico = document.getElementById('filtro-mecanico')?.value || '';
  const vista = document.getElementById('filtro-vista')?.value || 'activas';

  const queryParams = new URLSearchParams();
  queryParams.append('vista', vista);
  if (filtroEstado) queryParams.append('estado', filtroEstado);
  if (filtroMecanico) queryParams.append('mecanico_id', filtroMecanico);

  const url = `${API_URL}${queryParams.toString() ? '?' + queryParams.toString() : ''}`;

  try {
    const respuesta = await fetch(url);
    if (!respuesta.ok) throw new Error('Error al obtener datos');

    ordenesCargadas = await respuesta.json();
    renderizarOrdenes(ordenesCargadas);
  } catch (error) {
    console.error('Error de conexión:', error);
    const tbody = document.getElementById('tabla-ordenes');
    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="10" style="text-align: center; color: #e74c3c; padding: 20px;">
            ❌ No se pudo conectar con el servidor. Asegurate de que "node index.js" esté corriendo.
          </td>
        </tr>
      `;
    }
  }
}

function renderizarOrdenes(ordenes) {
  const tbody = document.getElementById('tabla-ordenes');
  if (!tbody) return;

  tbody.innerHTML = '';

  if (!ordenes || ordenes.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10" style="text-align: center; padding: 20px; color: #7f8c8d;">
          No hay órdenes de trabajo que coincidan con la búsqueda.
        </td>
      </tr>
    `;
    return;
  }

  ordenes.forEach((ot) => {
    const fila = document.createElement('tr');
    const estado = ot.estado || 'INGRESADO';
    const numeroOt = escapeHtml(ot.numero_ot);
    const textoBoton = ot.diagnostico_tecnico ? 'Ver / editar' : 'Cargar diagnóstico';

    // Mismo enlace, distinto uso según la etapa (Tarjeta 3.3)
    let textoPresupuesto = 'Armar presupuesto';
    if (estado === 'EN_REPARACION' || estado === 'LISTO') textoPresupuesto = 'Checklist de reparación';
    if (estado === 'ENTREGADO' || estado === 'CANCELADO') textoPresupuesto = 'Ver presupuesto';

    // Botones de cambio de estado (los clics se manejan por delegación más abajo)
    const siguiente = SIGUIENTE_ESTADO[estado];
    let botonesEstado = '';

    if (estado === 'LISTO') {
      // La entrega abre un modal con el resumen y guarda fecha y observaciones
      botonesEstado = `<button type="button" class="btn-entrega" data-numero-ot="${numeroOt}">Registrar entrega</button>`;
    } else if (estado === 'ENTREGADO') {
      botonesEstado = `<button type="button" class="btn-entrega" data-numero-ot="${numeroOt}">Ver entrega</button>`;
    } else if (estado === 'CANCELADO') {
      botonesEstado = '<small style="color: #7f8c8d;">Sin acciones</small>';
    } else {
      if (siguiente) {
        botonesEstado += `<button type="button" class="btn-estado" data-numero-ot="${numeroOt}" data-estado="${siguiente}">Avanzar a ${siguiente}</button> `;
      }
      if (PUEDE_CANCELAR.includes(estado)) {
        botonesEstado += `<button type="button" class="btn-estado" data-numero-ot="${numeroOt}" data-estado="CANCELADO">Cancelar</button>`;
      }
    }

    // Selector de mecánico para cada fila
    let opcionesMecanicos = '<option value="">Sin asignar</option>';
    mecanicosCargados.forEach((m) => {
      const seleccionado = ot.mecanico_id === m.id ? 'selected' : '';
      opcionesMecanicos += `<option value="${m.id}" ${seleccionado}>${escapeHtml(m.nombre)}</option>`;
    });
    const selectorMecanicoHtml = `<select class="select-mecanico" data-numero-ot="${numeroOt}">${opcionesMecanicos}</select>`;

    // 10 celdas: coinciden con las 10 columnas del encabezado de panel.html
    fila.innerHTML = `
      <td><strong>${numeroOt}</strong></td>
      <td><span class="patente-tag">${escapeHtml(ot.patente)}</span></td>
      <td>${escapeHtml(ot.marca)} ${escapeHtml(ot.modelo)}</td>
      <td>${escapeHtml(ot.cliente)}<br><small style="color: #7f8c8d;">${escapeHtml(ot.telefono)}</small></td>
      <td>${escapeHtml(ot.fallas_reportadas || 'Sin observaciones')}</td>
      <td><span class="estado-badge">${escapeHtml(estado)}</span>${
        estado === 'ENTREGADO' && ot.fecha_entrega
          ? `<br><small style="color: #7f8c8d;">${escapeHtml(formatearFecha(ot.fecha_entrega))}</small>`
          : ''
      }</td>
      <td>${selectorMecanicoHtml}</td>
      <td><button type="button" class="btn-diagnostico" data-numero-ot="${numeroOt}">${textoBoton}</button></td>
      <td><a href="presupuesto.html?ot=${encodeURIComponent(ot.numero_ot)}">${textoPresupuesto}</a></td>
      <td>${botonesEstado}</td>
    `;

    tbody.appendChild(fila);
  });
}

// ---------------------------------------------------------------
// 5. Modal de Diagnóstico Técnico
// ---------------------------------------------------------------
const modal = document.getElementById('modal-ot');
const formDiagnostico = document.getElementById('form-diagnostico');
const textareaDiagnostico = document.getElementById('diagnostico_tecnico');
const mensajeDiagnostico = document.getElementById('msg-diagnostico');

// Modal de entrega (Sprint 3 - Tarjeta 3.4)
const modalEntrega = document.getElementById('modal-entrega');
const formEntrega = document.getElementById('form-entrega');
const textareaObservaciones = document.getElementById('observaciones_entrega');
const mensajeEntrega = document.getElementById('msg-entrega');
const botonConfirmarEntrega = document.getElementById('btn-confirmar-entrega');
let otEntrega = null;

function abrirModal(numeroOt) {
  const ot = ordenesCargadas.find((o) => o.numero_ot === numeroOt);
  if (!ot) return;

  otSeleccionada = ot.numero_ot;

  document.getElementById('modal-titulo').textContent = `Orden de Trabajo ${ot.numero_ot}`;
  document.getElementById('modal-detalle').innerHTML = `
    <p><strong>Patente:</strong> ${escapeHtml(ot.patente)}</p>
    <p><strong>Vehículo:</strong> ${escapeHtml(ot.marca)} ${escapeHtml(ot.modelo)}</p>
    <p><strong>Cliente:</strong> ${escapeHtml(ot.cliente)} (${escapeHtml(ot.telefono)})</p>
    <p><strong>Mecánico:</strong> ${escapeHtml(ot.mecanico_nombre || 'Sin asignar')}</p>
    <p><strong>Estado:</strong> ${escapeHtml(ot.estado || 'INGRESADO')}</p>
    <p><strong>Fallas reportadas:</strong> ${escapeHtml(ot.fallas_reportadas || 'Sin observaciones')}</p>
  `;

  if (textareaDiagnostico) textareaDiagnostico.value = ot.diagnostico_tecnico || '';
  if (mensajeDiagnostico) mensajeDiagnostico.textContent = '';

  if (modal) modal.showModal();
}

// ---------------------------------------------------------------
// 6. Modal de Entrega del Vehículo (Sprint 3 - Tarjeta 3.4)
// ---------------------------------------------------------------
async function abrirModalEntrega(numeroOt) {
  const ot = ordenesCargadas.find((o) => o.numero_ot === numeroOt);
  if (!ot || !modalEntrega) return;

  otEntrega = ot.numero_ot;
  const entregada = ot.estado === 'ENTREGADO';

  document.getElementById('entrega-titulo').textContent =
    entregada ? `Entrega registrada — ${ot.numero_ot}` : `Entrega del vehículo — ${ot.numero_ot}`;

  document.getElementById('entrega-detalle').innerHTML = `
    <p><strong>Patente:</strong> ${escapeHtml(ot.patente)}</p>
    <p><strong>Vehículo:</strong> ${escapeHtml(ot.marca)} ${escapeHtml(ot.modelo)}</p>
    <p><strong>Cliente:</strong> ${escapeHtml(ot.cliente)} (${escapeHtml(ot.telefono)})</p>
    <p><strong>Mecánico:</strong> ${escapeHtml(ot.mecanico_nombre || 'Sin asignar')}</p>
    ${entregada ? `<p><strong>Fecha de entrega:</strong> ${escapeHtml(formatearFecha(ot.fecha_entrega))}</p>` : ''}
  `;

  // Si ya está entregada, el modal es de solo lectura
  textareaObservaciones.value = ot.observaciones_entrega || '';
  textareaObservaciones.readOnly = entregada;
  botonConfirmarEntrega.hidden = entregada;
  mensajeEntrega.textContent = '';
  document.getElementById('entrega-items-body').innerHTML =
    '<tr><td colspan="4">Cargando presupuesto...</td></tr>';
  document.getElementById('entrega-total').textContent = '';

  modalEntrega.showModal();
  await cargarResumenPresupuesto(ot.numero_ot);
}

async function cargarResumenPresupuesto(numeroOt) {
  const cuerpo = document.getElementById('entrega-items-body');

  try {
    const respuesta = await fetch(`${API_URL}/${encodeURIComponent(numeroOt)}/presupuesto`);
    const datos = await respuesta.json();

    if (!respuesta.ok) {
      cuerpo.innerHTML = `<tr><td colspan="4">❌ ${escapeHtml(datos.error)}</td></tr>`;
      return;
    }

    if (datos.items.length === 0) {
      cuerpo.innerHTML = '<tr><td colspan="4">Esta OT no tiene ítems en el presupuesto.</td></tr>';
    } else {
      cuerpo.innerHTML = datos.items.map((item) => {
        const subtotal = Math.round(item.cantidad * item.precio_unitario * 100) / 100;
        const tipo = item.tipo === 'MANO_DE_OBRA' ? 'Mano de obra' : 'Repuesto';
        return `
          <tr>
            <td>${escapeHtml(tipo)}: ${escapeHtml(item.descripcion_repuesto)}</td>
            <td class="num">${escapeHtml(item.cantidad)}</td>
            <td class="num">${formatoMoneda.format(item.precio_unitario)}</td>
            <td class="num">${formatoMoneda.format(subtotal)}</td>
          </tr>`;
      }).join('');
    }

    document.getElementById('entrega-total').textContent = `Total: ${formatoMoneda.format(datos.total)}`;
  } catch (error) {
    console.error('Error al cargar el resumen del presupuesto:', error);
    cuerpo.innerHTML = '<tr><td colspan="4">❌ No se pudo conectar con el servidor.</td></tr>';
  }
}

// ---------------------------------------------------------------
// Listeners e Inicialización
// ---------------------------------------------------------------
document.addEventListener('DOMContentLoaded', async () => {
  await cargarMecanicos();
  await obtenerYMostrarOrdenes();

  // Filtros de la cabecera
  document.getElementById('filtro-estado')?.addEventListener('change', obtenerYMostrarOrdenes);
  document.getElementById('filtro-mecanico')?.addEventListener('change', obtenerYMostrarOrdenes);
  document.getElementById('filtro-vista')?.addEventListener('change', () => {
    // El estado elegido puede no existir en la otra vista: se limpia el filtro
    const filtroEstado = document.getElementById('filtro-estado');
    if (filtroEstado) filtroEstado.value = '';
    obtenerYMostrarOrdenes();
  });

  const tbody = document.getElementById('tabla-ordenes');

  // Delegación de eventos: un solo listener para botones y selectores de todas las filas
  tbody?.addEventListener('click', (e) => {
    const botonDiagnostico = e.target.closest('.btn-diagnostico');
    if (botonDiagnostico) {
      abrirModal(botonDiagnostico.dataset.numeroOt);
      return;
    }
    const botonEstado = e.target.closest('.btn-estado');
    if (botonEstado) {
      cambiarEstado(botonEstado.dataset.numeroOt, botonEstado.dataset.estado);
      return;
    }
    const botonEntrega = e.target.closest('.btn-entrega');
    if (botonEntrega) {
      abrirModalEntrega(botonEntrega.dataset.numeroOt);
    }
  });

  tbody?.addEventListener('change', (e) => {
    const selector = e.target.closest('.select-mecanico');
    if (selector) cambiarMecanico(selector.dataset.numeroOt, selector.value);
  });

  document.getElementById('cerrar-modal')?.addEventListener('click', () => modal?.close());
  document.getElementById('cerrar-modal-entrega')?.addEventListener('click', () => modalEntrega?.close());

  formEntrega?.addEventListener('submit', async (e) => {
    e.preventDefault();
    botonConfirmarEntrega.disabled = true;
    mensajeEntrega.textContent = 'Registrando entrega...';

    try {
      const respuesta = await fetch(`${API_URL}/${encodeURIComponent(otEntrega)}/entrega`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ observaciones_entrega: textareaObservaciones.value })
      });
      const resultado = await respuesta.json();

      if (!respuesta.ok) {
        mensajeEntrega.textContent = '❌ ' + resultado.error;
        return;
      }

      modalEntrega.close();
      alert(`${resultado.mensaje} Total del presupuesto: ${formatoMoneda.format(resultado.total)}`);
      obtenerYMostrarOrdenes(); // la OT pasa al historial
    } catch (error) {
      console.error('Error al registrar la entrega:', error);
      mensajeEntrega.textContent = '❌ No se pudo conectar con el servidor.';
    } finally {
      botonConfirmarEntrega.disabled = false;
    }
  });

  formDiagnostico?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const texto = textareaDiagnostico.value.trim();

    if (!texto) {
      mensajeDiagnostico.textContent = '⚠️ Escribí el diagnóstico antes de guardar.';
      return;
    }

    mensajeDiagnostico.textContent = 'Guardando...';

    try {
      const respuesta = await fetch(`${API_URL}/${encodeURIComponent(otSeleccionada)}/diagnostico`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ diagnostico_tecnico: texto })
      });

      const resultado = await respuesta.json();

      if (!respuesta.ok) {
        mensajeDiagnostico.textContent = '❌ ' + resultado.error;
        return;
      }

      obtenerYMostrarOrdenes();
      mensajeDiagnostico.textContent = '✅ Diagnóstico guardado correctamente.';
    } catch (error) {
      console.error('Error al guardar el diagnóstico:', error);
      mensajeDiagnostico.textContent = '❌ No se pudo conectar con el servidor.';
    }
  });
});
