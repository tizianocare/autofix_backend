const API_URL = 'http://localhost:3000/api/ordenes-trabajo';

// Listas globales
let ordenesCargadas = [];
let mecanicosCargados = [];
let otSeleccionada = null;

// Mapa de transiciones de estado
const SIGUIENTE_ESTADO = {
    'INGRESADO': 'DIAGNOSTICO',
    'DIAGNOSTICO': 'PRESUPUESTADO',
    'PRESUPUESTADO': 'EN_REPARACION',
    'EN_REPARACION': 'LISTO',
    'LISTO': 'ENTREGADO'
};

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
    if (!confirm(`¿Confirmas cambiar el estado de la OT ${numero_ot} a ${nuevo_estado}?`)) return;

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

    const queryParams = new URLSearchParams();
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
                    <td colspan="10" class="text-center text-danger">❌ No se pudo conectar con el servidor. Asegurate de que "node index.js" esté corriendo.</td>
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
                <td colspan="10" class="text-center">No hay órdenes de trabajo que coincidan con la búsqueda.</td>
            </tr>
        `;
        return;
    }

    ordenes.forEach((ot) => {
        const fila = document.createElement('tr');
        const estado = ot.estado || 'INGRESADO';
        const textoBoton = ot.diagnostico_tecnico ? 'Ver / editar' : 'Cargar diagnóstico';

        // 🟢 Botones de cambio de estado
        const siguiente = SIGUIENTE_ESTADO[estado];
        let botonesEstado = '';

        if (siguiente) {
            botonesEstado += `<button class="btn btn-sm btn-primary mb-1" onclick="cambiarEstado('${ot.numero_ot}', '${siguiente}')">Avanzar a ${siguiente}</button> `;
        }

        if (estado !== 'ENTREGADO' && estado !== 'CANCELADO') {
            botonesEstado += `<button class="btn btn-sm btn-danger mb-1" onclick="cambiarEstado('${ot.numero_ot}', 'CANCELADO')">Cancelar</button>`;
        }

        if (estado === 'ENTREGADO' || estado === 'CANCELADO') {
            botonesEstado = `<span class="text-muted">Sin acciones</span>`;
        }

        // 🟢 Selector de mecánico para cada fila
        let opcionesMecanicos = `<option value="">Sin asignar</option>`;
        mecanicosCargados.forEach((m) => {
            const seleccionado = ot.mecanico_id === m.id ? 'selected' : '';
            opcionesMecanicos += `<option value="${m.id}" ${seleccionado}>${escapeHtml(m.nombre)}</option>`;
        });

        const selectorMecanicoHtml = `
            <select class="form-select form-select-sm" onchange="cambiarMecanico('${ot.numero_ot}', this.value)">
                ${opcionesMecanicos}
            </select>
        `;

        fila.innerHTML = `
            <td>${escapeHtml(ot.numero_ot)}</td>
            <td>${escapeHtml(ot.patente)}</td>
            <td>${escapeHtml(ot.marca)}</td>
            <td>${escapeHtml(ot.modelo)}</td>
            <td>${escapeHtml(ot.cliente)}<br><small class="text-muted">${escapeHtml(ot.telefono)}</small></td>
            <td>${escapeHtml(ot.fallas_reportadas || 'Sin observaciones')}</td>
            <td><span class="badge bg-secondary">${escapeHtml(estado)}</span></td>
            <td>${selectorMecanicoHtml}</td>
            <td><button class="btn btn-sm btn-info btn-diagnostico" data-numero-ot="${escapeHtml(ot.numero_ot)}">${textoBoton}</button></td>
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

function abrirModal(numeroOt) {
    const ot = ordenesCargadas.find((o) => o.numero_ot === numeroOt);
    if (!ot) return;

    otSeleccionada = ot.numero_ot;

    document.getElementById('modal-titulo').textContent = `Orden de Trabajo ${ot.numero_ot}`;
    document.getElementById('modal-detalle').innerHTML = `
        <strong>Patente:</strong> ${escapeHtml(ot.patente)}<br>
        <strong>Vehículo:</strong> ${escapeHtml(ot.marca)} ${escapeHtml(ot.modelo)}<br>
        <strong>Cliente:</strong> ${escapeHtml(ot.cliente)} (${escapeHtml(ot.telefono)})<br>
        <strong>Mecánico:</strong> ${escapeHtml(ot.mecanico_nombre || 'Sin asignar')}<br>
        <strong>Estado:</strong> ${escapeHtml(ot.estado || 'INGRESADO')}<br>
        <strong>Fallas reportadas:</strong> ${escapeHtml(ot.fallas_reportadas || 'Sin observaciones')}
    `;

    if (textareaDiagnostico) textareaDiagnostico.value = ot.diagnostico_tecnico || '';
    if (mensajeDiagnostico) mensajeDiagnostico.textContent = '';

    if (modal) modal.showModal();
}

// Listeners e Inicialización
document.addEventListener('DOMContentLoaded', async () => {
    await cargarMecanicos();
    await obtenerYMostrarOrdenes();

    // Listeners para los filtros de la cabecera
    document.getElementById('filtro-estado')?.addEventListener('change', obtenerYMostrarOrdenes);
    document.getElementById('filtro-mecanico')?.addEventListener('change', obtenerYMostrarOrdenes);

    // Delegación de evento para abrir modal
    document.getElementById('tabla-ordenes')?.addEventListener('click', (e) => {
        const boton = e.target.closest('.btn-diagnostico');
        if (boton) abrirModal(boton.dataset.numeroOt);
    });

    document.getElementById('cerrar-modal')?.addEventListener('click', () => modal?.close());

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
