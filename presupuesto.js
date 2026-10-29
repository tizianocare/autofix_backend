const API_URL = 'http://localhost:3000/api/ordenes-trabajo';

// El número de OT llega por la URL: presupuesto.html?ot=OT-0001
const numeroOt = new URLSearchParams(window.location.search).get('ot');

// Desde estos estados el presupuesto queda fijo y se muestra como checklist
// (debe coincidir con ESTADOS_SIN_EDICION de rutas_presupuesto.js)
const ESTADOS_PRESUPUESTO_FIJO = ['EN_REPARACION', 'LISTO', 'ENTREGADO', 'CANCELADO'];

const form = document.getElementById('form-presupuesto');
const tbody = document.getElementById('items');
const mensaje = document.getElementById('mensaje');
const infoOt = document.getElementById('info-ot');
const botonGuardar = document.getElementById('btn-guardar');

const seccionChecklist = document.getElementById('seccion-checklist');
const listaChecklist = document.getElementById('lista-checklist');
const barraProgreso = document.getElementById('barra-progreso');
const textoProgreso = document.getElementById('texto-progreso');
const mensajeChecklist = document.getElementById('mensaje-checklist');

const formatoMoneda = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });
const redondear2 = (n) => Math.round(n * 100) / 100;

let ordenActual = null;
let itemsChecklist = [];

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
// Filas dinámicas del formulario de presupuesto (Tarjeta 2.3)
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

tbody.addEventListener('click', (e) => {
  const boton = e.target.closest('.btn-quitar');
  if (boton) {
    boton.closest('tr').remove();
    recalcular();
  }
});

// Cálculo en centavos (enteros) para evitar errores de decimales
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

tbody.addEventListener('input', recalcular);
tbody.addEventListener('change', recalcular);

// ---------------------------------------------------------------
// Checklist de reparación (Sprint 3 - Tarjeta 3.3)
// ---------------------------------------------------------------
function actualizarProgreso({ completados, total }) {
  barraProgreso.max = total || 1;
  barraProgreso.value = completados;
  textoProgreso.textContent = `${completados} de ${total} ítems realizados`;

  if (total > 0 && completados === total && ordenActual.estado === 'EN_REPARACION') {
    mensajeChecklist.textContent = '✅ Checklist completo: ya podés pasar la OT a LISTO desde el panel.';
  } else if (mensajeChecklist.textContent.startsWith('✅')) {
    mensajeChecklist.textContent = '';
  }
}

function mostrarChecklist(items, total) {
  itemsChecklist = items;
  // Los ítems solo se pueden tildar mientras la OT está en reparación
  const editable = ordenActual.estado === 'EN_REPARACION';

  seccionChecklist.hidden = false;
  form.hidden = true;
  listaChecklist.innerHTML = '';

  items.forEach((item) => {
    const li = document.createElement('li');
    if (item.completado) li.classList.add('hecho');

    const label = document.createElement('label');
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = item.completado;
    check.disabled = !editable;
    check.dataset.itemId = item.id;

    // textContent: la descripción del ítem nunca se interpreta como HTML
    const texto = document.createElement('span');
    const tipo = item.tipo === 'MANO_DE_OBRA' ? 'Mano de obra' : 'Repuesto';
    texto.textContent =
      `${tipo}: ${item.descripcion_repuesto} (${item.cantidad} × ${formatoMoneda.format(item.precio_unitario)})`;

    label.append(check, texto);
    li.append(label);
    listaChecklist.append(li);
  });

  document.getElementById('total-checklist').textContent = formatoMoneda.format(total);
  actualizarProgreso({
    completados: items.filter((it) => it.completado).length,
    total: items.length
  });

  if (!editable) {
    mensajeChecklist.textContent = 'El checklist es de solo lectura porque la OT ya no está en reparación.';
  }
}

// Un solo listener para todas las casillas (delegación de eventos)
listaChecklist.addEventListener('change', async (e) => {
  const check = e.target.closest('input[type="checkbox"]');
  if (!check) return;

  const itemId = check.dataset.itemId;
  const marcado = check.checked;
  check.disabled = true;
  mensajeChecklist.textContent = '';

  try {
    const respuesta = await fetch(
      `${API_URL}/${encodeURIComponent(numeroOt)}/presupuesto/items/${encodeURIComponent(itemId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completado: marcado })
      }
    );
    const resultado = await respuesta.json();

    if (!respuesta.ok) {
      check.checked = !marcado; // se deshace el cambio visual
      mensajeChecklist.textContent = '❌ ' + resultado.error;
      return;
    }

    const item = itemsChecklist.find((it) => String(it.id) === itemId);
    if (item) item.completado = marcado;
    check.closest('li').classList.toggle('hecho', marcado);
    actualizarProgreso(resultado.progreso);
  } catch (error) {
    console.error('Error al actualizar el checklist:', error);
    check.checked = !marcado;
    mensajeChecklist.textContent = '❌ No se pudo conectar con el servidor.';
  } finally {
    check.disabled = false;
  }
});

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

    if (ESTADOS_PRESUPUESTO_FIJO.includes(ordenActual.estado)) {
      // El presupuesto ya no se edita: se muestra como checklist de reparación
      mostrarChecklist(datos.items, datos.total);
    } else if (datos.items.length === 0) {
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
// Guardar el presupuesto (PUT)
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
