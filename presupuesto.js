const API_URL = 'http://localhost:3000/api/ordenes-trabajo';

// El número de OT llega por la URL: presupuesto.html?ot=OT-7681
const numeroOt = new URLSearchParams(window.location.search).get('ot');

const form = document.getElementById('form-presupuesto');
const tbody = document.getElementById('items');
const mensaje = document.getElementById('mensaje');
const infoOt = document.getElementById('info-ot');
const botonGuardar = document.getElementById('btn-guardar');

const formatoMoneda = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });
const redondear2 = (n) => Math.round(n * 100) / 100;

let ordenActual = null;

// ---------------------------------------------------------------
// Encabezado con los datos de la OT (textContent: no interpreta HTML)
// ---------------------------------------------------------------
function mostrarOrden(orden) {
  infoOt.textContent =
    `${orden.numero_ot} — ${orden.marca} ${orden.modelo} (${orden.patente}) — ` +
    `Cliente: ${orden.cliente} — Estado: ${orden.estado}`;
  document.getElementById('diagnostico-ot').textContent =
    orden.diagnostico_tecnico || 'Todavía no hay diagnóstico técnico cargado para esta OT.';
}

// ---------------------------------------------------------------
// Filas dinámicas (tarea 2)
// ---------------------------------------------------------------
function agregarFila(item = {}) {
  const tr = document.createElement('tr');
  // HTML fijo, sin datos del usuario; los valores se asignan después con .value
  tr.innerHTML = `
    <td>
      <select class="f-tipo">
        <option value="REPUESTO">Repuesto</option>
        <option value="MANO_DE_OBRA">Mano de obra</option>
      </select>
    </td>
    <td><input type="text" class="f-desc" maxlength="200" required placeholder="Descripción"></td>
    <td><input type="number" class="f-cant" min="0.01" max="99999" step="0.01" required></td>
    <td><input type="number" class="f-precio" min="0" step="0.01" required></td>
    <td class="f-subtotal">${formatoMoneda.format(0)}</td>
    <td><button type="button" class="btn-quitar" title="Quitar ítem">✕</button></td>
  `;

  tr.querySelector('.f-tipo').value = item.tipo || 'REPUESTO';
  tr.querySelector('.f-desc').value = item.descripcion_repuesto || '';
  tr.querySelector('.f-cant').value = item.cantidad ?? 1;
  tr.querySelector('.f-precio').value = item.precio_unitario ?? '';

  tbody.appendChild(tr);
  recalcular();
}

document.getElementById('btn-add-repuesto').addEventListener('click', () => {
  agregarFila({ tipo: 'REPUESTO' });
});
document.getElementById('btn-add-mano-obra').addEventListener('click', () => {
  agregarFila({ tipo: 'MANO_DE_OBRA' });
});

// Quitar una fila (delegación de eventos: un solo listener para todos los botones)
tbody.addEventListener('click', (e) => {
  const boton = e.target.closest('.btn-quitar');
  if (boton) {
    boton.closest('tr').remove();
    recalcular();
  }
});

// ---------------------------------------------------------------
// Cálculo automático de totales (tarea 3)
// Se calcula en centavos (enteros) para evitar errores de decimales
// ---------------------------------------------------------------
function recalcular() {
  let centRepuestos = 0;
  let centManoObra = 0;

  tbody.querySelectorAll('tr').forEach((tr) => {
    const cantidad = redondear2(parseFloat(tr.querySelector('.f-cant').value) || 0);
    const precio = redondear2(parseFloat(tr.querySelector('.f-precio').value) || 0);
    const centavos = Math.round(cantidad * precio * 100);

    tr.querySelector('.f-subtotal').textContent = formatoMoneda.format(centavos / 100);

    if (tr.querySelector('.f-tipo').value === 'MANO_DE_OBRA') {
      centManoObra += centavos;
    } else {
      centRepuestos += centavos;
    }
  });

  document.getElementById('total-repuestos').textContent = formatoMoneda.format(centRepuestos / 100);
  document.getElementById('total-mano-obra').textContent = formatoMoneda.format(centManoObra / 100);
  document.getElementById('total-general').textContent =
    formatoMoneda.format((centRepuestos + centManoObra) / 100);
}

// Cada vez que el mecánico escribe o cambia el tipo, se recalcula
tbody.addEventListener('input', recalcular);
tbody.addEventListener('change', recalcular);

// ---------------------------------------------------------------
// Cargar la OT y su presupuesto existente (si ya tenía uno)
// ---------------------------------------------------------------
async function cargarPresupuesto() {
  if (!numeroOt) {
    infoOt.textContent = '⚠️ Falta el número de OT. Entrá desde el panel de órdenes.';
    form.hidden = true;
    return;
  }

  try {
    const respuesta = await fetch(`${API_URL}/${encodeURIComponent(numeroOt)}/presupuesto`);
    const datos = await respuesta.json();

    if (!respuesta.ok) {
      infoOt.textContent = '❌ ' + datos.error;
      form.hidden = true;
      return;
    }

    ordenActual = datos.orden;
    mostrarOrden(ordenActual);

    if (datos.items.length === 0) {
      agregarFila({ tipo: 'REPUESTO' });
    } else {
      datos.items.forEach((item) => agregarFila(item));
    }
  } catch (error) {
    console.error('Error al cargar el presupuesto:', error);
    infoOt.textContent = '❌ No se pudo conectar con el servidor.';
    form.hidden = true;
  }
}

// ---------------------------------------------------------------
// Guardar el presupuesto (tarea 4: llama al endpoint PUT)
// ---------------------------------------------------------------
form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const filas = [...tbody.querySelectorAll('tr')];
  if (filas.length === 0) {
    mensaje.textContent = '⚠️ Agregá al menos un ítem al presupuesto.';
    return;
  }

  const items = filas.map((tr) => ({
    tipo: tr.querySelector('.f-tipo').value,
    descripcion_repuesto: tr.querySelector('.f-desc').value.trim(),
    cantidad: tr.querySelector('.f-cant').value,
    precio_unitario: tr.querySelector('.f-precio').value
  }));

  botonGuardar.disabled = true;
  mensaje.textContent = 'Guardando...';

  try {
    const respuesta = await fetch(`${API_URL}/${encodeURIComponent(numeroOt)}/presupuesto`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items })
    });
    const resultado = await respuesta.json();

    if (!respuesta.ok) {
      mensaje.textContent = '❌ ' + resultado.error;
      return;
    }

    ordenActual.estado = resultado.estado;
    mostrarOrden(ordenActual);
    mensaje.textContent =
      `✅ Presupuesto guardado (${resultado.cantidad_items} ítems, total ${formatoMoneda.format(resultado.total)}). ` +
      `Estado de la OT: ${resultado.estado}.`;
  } catch (error) {
    console.error('Error al guardar el presupuesto:', error);
    mensaje.textContent = '❌ No se pudo conectar con el servidor.';
  } finally {
    botonGuardar.disabled = false;
  }
});

document.addEventListener('DOMContentLoaded', cargarPresupuesto);
