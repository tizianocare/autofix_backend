const API_URL = 'http://localhost:3000/api/ordenes-trabajo';

// Lista de OTs cargadas desde el backend (se reutiliza para abrir el modal sin otra petición)
let ordenesCargadas = [];
let otSeleccionada = null;

// 🗺️ Transiciones de estado permitidas
const SIGUIENTE_ESTADO = {
    'INGRESADO': 'DIAGNOSTICO',
    'DIAGNOSTICO': 'PRESUPUESTADO',
    'PRESUPUESTADO': 'EN_REPARACION',
    'EN_REPARACION': 'LISTO',
    'LISTO': 'ENTREGADO'
};

// Evita que texto escrito por usuarios se interprete como HTML (protección XSS)
function escapeHtml(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 🔄 Función para cambiar de estado vía PATCH 
async function cambiarEstado(numero_ot, nuevo_estado) {
    if (!confirm(`¿Confirmas cambiar el estado de la OT ${numero_ot} a ${nuevo_estado}?`)) return;

    try {
        const respuesta = await fetch(`http://localhost:3000/api/ordenes-trabajo/${encodeURIComponent(numero_ot)}/estado`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ nuevo_estado })
        });

        const resultado = await respuesta.json();

        if (respuesta.ok) {
            alert(resultado.mensaje);
            obtenerYMostrarOrdenes(); // Recargar la lista automáticamente
        } else {
            alert(`Error: ${resultado.error}`);
        }
    } catch (error) {
        console.error('Error al cambiar el estado:', error);
        alert('No se pudo conectar con el servidor.');
    }
}

// ---------------------------------------------------------------
// Listado de OTs
// ---------------------------------------------------------------
async function obtenerYMostrarOrdenes() {
  try {
    const respuesta = await fetch(API_URL);
    if (!respuesta.ok) {
      throw new Error('Error al obtener los datos del servidor');
    }
    ordenesCargadas = await respuesta.json();
    renderizarOrdenes(ordenesCargadas);
  } catch (error) {
    console.error('Error de conexión:', error);
    const tbody = document.getElementById('tabla-ordenes');
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; color: #e74c3c; padding: 20px;">
          ❌ No se pudo conectar con el servidor. Asegurate de que "node index.js" esté corriendo.
        </td>
      </tr>
    `;
  }
}

function renderizarOrdenes(ordenes) {
    const tbody = document.getElementById('tabla-ordenes');
    tbody.innerHTML = '';

    if (!ordenes || ordenes.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="10" class="text-center">No hay órdenes de trabajo activas en este momento.</td>
            </tr>
        `;
        return;
    }

    ordenes.forEach((ot) => {
        const fila = document.createElement('tr');
        const estado = ot.estado || 'INGRESADO';
        const textoBoton = ot.diagnostico_tecnico ? 'Ver / editar' : 'Cargar diagnóstico';
        const siguiente = SIGUIENTE_ESTADO[estado];
        
        let botonesAccion = '';
        
        if (siguiente) {
            botonesAccion += `<button class="btn btn-sm btn-primary" onclick="cambiarEstado('${ot.numero_ot}', '${siguiente}')">Avanzar a ${siguiente}</button> `;
        }
        
        if (estado !== 'ENTREGADO' && estado !== 'CANCELADO') {
            botonesAccion += `<button class="btn btn-sm btn-danger" onclick="cambiarEstado('${ot.numero_ot}', 'CANCELADO')">Cancelar</button>`;
        }
        
        if (estado === 'ENTREGADO' || estado === 'CANCELADO') {
            botonesAccion = '<span class="text-muted">Sin acciones</span>';
        }

        fila.innerHTML = `
            <td>${escapeHtml(ot.numero_ot)}</td>
            <td>${escapeHtml(ot.patente)}</td>
            <td>${escapeHtml(ot.marca)}</td>
            <td>${escapeHtml(ot.modelo)}</td>
            <td>${escapeHtml(ot.cliente)}</td>
            <td>${escapeHtml(ot.telefono)}</td>
            <td>${escapeHtml(ot.fallas_reportadas || 'Sin observaciones')}</td>
            <td><span class="badge badge-estado">${escapeHtml(estado)}</span></td>
            <td><button class="btn btn-sm btn-info">${textoBoton}</button></td>
            <td>${botonesAccion}</td>
        `;
        
        tbody.appendChild(fila);
    });
}

// ---------------------------------------------------------------
// Modal de detalle + diagnóstico técnico (Tarjeta 2.1)
// ---------------------------------------------------------------
const modal = document.getElementById('modal-ot');
const formDiagnostico = document.getElementById('form-diagnostico');
const textareaDiagnostico = document.getElementById('diagnostico_tecnico');
const mensajeDiagnostico = document.getElementById('msg-diagnostico');

function abrirModal(numeroOt) {
  const ot = ordenesCargadas.find((o) => o.numero_ot === numeroOt);
  if (!ot) return;

  otSeleccionada = ot.numero_ot;
  document.getElementById('modal-titulo').textContent = `Orden de Trabajo ${ot.numero_ot}`;
  document.getElementById('modal-detalle').innerHTML = `
    <p><strong>Patente:</strong> ${escapeHtml(ot.patente)}</p>
    <p><strong>Vehículo:</strong> ${escapeHtml(ot.marca)} ${escapeHtml(ot.modelo)}</p>
    <p><strong>Cliente:</strong> ${escapeHtml(ot.cliente)} (${escapeHtml(ot.telefono)})</p>
    <p><strong>Estado:</strong> ${escapeHtml(ot.estado || 'INGRESADO')}</p>
    <p><strong>Fallas reportadas:</strong> ${escapeHtml(ot.fallas_reportadas || 'Sin observaciones')}</p>
  `;
  textareaDiagnostico.value = ot.diagnostico_tecnico || '';
  mensajeDiagnostico.textContent = '';
  modal.showModal();
}

// Un solo listener para todos los botones de la tabla (delegación de eventos)
document.getElementById('tabla-ordenes').addEventListener('click', (e) => {
  const boton = e.target.closest('.btn-diagnostico');
  if (boton) abrirModal(boton.dataset.numeroOt);
});

document.getElementById('cerrar-modal').addEventListener('click', () => modal.close());

formDiagnostico.addEventListener('submit', async (e) => {
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

    // Actualiza la copia local y refresca la tabla (el botón pasa a "Ver / editar")
    const ot = ordenesCargadas.find((o) => o.numero_ot === otSeleccionada);
    if (ot) ot.diagnostico_tecnico = texto;
    renderizarOrdenes(ordenesCargadas);

    mensajeDiagnostico.textContent = '✅ Diagnóstico guardado correctamente.';
  } catch (error) {
    console.error('Error al guardar el diagnóstico:', error);
    mensajeDiagnostico.textContent = '❌ No se pudo conectar con el servidor.';
  }
});

// Cargar la lista automáticamente al abrir la página
document.addEventListener('DOMContentLoaded', obtenerYMostrarOrdenes);
