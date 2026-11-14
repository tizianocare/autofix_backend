const API_URL = 'http://localhost:3000/api/ordenes-trabajo';

// El número de OT llega por la URL: presupuesto.html?ot=OT-0001
const numeroOt = new URLSearchParams(window.location.search).get('ot');

const form = document.getElementById('form-presupuesto');
const tbody = document.getElementById('items');
const mensaje = document.getElementById('mensaje');
const infoOt = document.getElementById('info-ot');
const botonGuardar = document.getElementById('btn-guardar');
const tituloForm = document.getElementById('titulo-form');
const avisoForm = document.getElementById('aviso-form');

const seccionChecklist = document.getElementById('seccion-checklist');
const tituloLista = document.getElementById('titulo-lista');
const listaChecklist = document.getElementById('lista-checklist');
const barraProgreso = document.getElementById('barra-progreso');
const textoProgreso = document.getElementById('texto-progreso');
const mensajeChecklist = document.getElementById('mensaje-checklist');

const formatoMoneda = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });
const redondear2 = (n) => Math.round(n * 100) / 100;

// Estados en los que todavía no empezó la reparación
const ESTADOS_ANTES_DE_REPARAR = ['INGRESADO', 'EN_DIAGNOSTICO', 'DIAGNOSTICADO', 'EN_PRESUPUESTO', 'PRESUPUESTADO'];
// Estados de la reparación y posteriores: la lista se muestra como checklist
const ESTADOS_DE_REPARACION = ['EN_REPARACION', 'REPARADO', 'ENTREGADO', 'CANCELADO'];

let ordenActual = null;
let modoAmpliacion = false; // true: el formulario carga trabajos adicionales (fallas nuevas)

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
// Filas dinámicas del formulario
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
// Lista de ítems: checklist de reparación y decisión del cliente
// ---------------------------------------------------------------
function crearEtiqueta(texto, clase) {
  const span = document.createElement('span');
  span.className = `etiqueta ${clase}`;
  span.textContent = texto;
  return span;
}

function actualizarProgreso({ completados, total }) {
  barraProgreso.max = total || 1;
  barraProgreso.value = completados;
  textoProgreso.textContent = `${completados} de ${total} ítems realizados`;

  if (ordenActual.estado === 'EN_REPARACION') {
    if (total > 0 && completados === total) {
      mensajeChecklist.textContent = '✅ Checklist completo: ya podés pasar la OT a REPARADO desde el panel.';
    } else if (mensajeChecklist.textContent.startsWith('✅')) {
      mensajeChecklist.textContent = '';
    }
  }
}

function mostrarLista(datos, items) {
  const estado = ordenActual.estado;
  const enReparacion = estado === 'EN_REPARACION';

  seccionChecklist.hidden = items.length === 0;
  tituloLista.textContent = ESTADOS_DE_REPARACION.includes(estado)
    ? 'Checklist de reparación'
    : 'Presupuesto aprobado y trabajos adicionales';
  listaChecklist.innerHTML = '';

  items.forEach((item) => {
    const li = document.createElement('li');
    const tipo = item.tipo === 'MANO_DE_OBRA' ? 'Mano de obra' : 'Repuesto';
    // textContent: la descripción del ítem nunca se interpreta como HTML
    const texto = document.createElement('span');
    texto.className = 'texto-item';
    texto.textContent =
      `${tipo}: ${item.descripcion_repuesto} (${item.cantidad} × ${formatoMoneda.format(item.precio_unitario)})`;

    if (item.estado_aprobacion === 'APROBADO') {
      // Se tilda solo mientras la OT está en reparación
      if (item.completado) li.classList.add('hecho');
      const label = document.createElement('label');
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.checked = item.completado;
      check.disabled = !enReparacion;
      check.dataset.itemId = item.id;
      label.append(check, texto);
      li.append(label);
      if (item.adicional) li.append(crearEtiqueta('Adicional aprobado', 'aprobado'));
    } else if (item.estado_aprobacion === 'PENDIENTE') {
      li.append(texto, crearEtiqueta('Adicional · pendiente de decisión', 'pendiente'));
      // La decisión del cliente se registra con la OT en PRESUPUESTADO
      if (estado === 'PRESUPUESTADO') {
        for (const [decision, rotulo] of [['APROBADO', 'Aprobar'], ['RECHAZADO', 'Rechazar']]) {
          const boton = document.createElement('button');
          boton.type = 'button';
          boton.className = 'btn-decision';
          boton.dataset.itemId = item.id;
          boton.dataset.decision = decision;
          boton.textContent = rotulo;
          li.append(boton);
        }
      }
    } else {
      // RECHAZADO: queda como registro, sin sumar al total ni al checklist
      li.classList.add('rechazado');
      li.append(texto, crearEtiqueta('Adicional rechazado por el cliente', 'rechazado'));
    }
    listaChecklist.append(li);
  });

  document.getElementById('total-checklist').textContent = formatoMoneda.format(datos.total);
  const hayPendiente = datos.total_pendiente > 0 || items.some((it) => it.estado_aprobacion === 'PENDIENTE');
  document.getElementById('fila-total-pendiente').hidden = !hayPendiente;
  document.getElementById('total-pendiente').textContent = formatoMoneda.format(datos.total_pendiente);

  actualizarProgreso(datos.progreso);

  // Mensajes de ayuda según la etapa
  const sinDecision = items.filter((it) => it.estado_aprobacion === 'PENDIENTE').length;
  if (estado === 'PRESUPUESTADO' && datos.ampliacion) {
    mensajeChecklist.textContent = sinDecision > 0
      ? `Registrá la decisión del cliente en los ${sinDecision} trabajo(s) adicional(es) pendiente(s).`
      : '✅ Todos los adicionales tienen decisión: ya podés avanzar la OT a EN_REPARACION desde el panel.';
  } else if (!enReparacion && ESTADOS_DE_REPARACION.includes(estado)) {
    mensajeChecklist.textContent = 'El checklist es de solo lectura porque la OT ya no está en reparación.';
  }
}

// Un solo listener para todas las casillas del checklist (delegación de eventos)
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

// Decisión del cliente sobre un trabajo adicional (Aprobar / Rechazar)
listaChecklist.addEventListener('click', async (e) => {
  const boton = e.target.closest('.btn-decision');
  if (!boton) return;

  boton.disabled = true;
  try {
    const respuesta = await fetch(
      `${API_URL}/${encodeURIComponent(numeroOt)}/presupuesto/items/${encodeURIComponent(boton.dataset.itemId)}/decision`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: boton.dataset.decision })
      }
    );
    const resultado = await respuesta.json();

    if (!respuesta.ok) {
      mensajeChecklist.textContent = '❌ ' + resultado.error;
      boton.disabled = false;
      return;
    }
    await cargarPresupuesto(); // se vuelve a dibujar con la decisión registrada
  } catch (error) {
    console.error('Error al registrar la decisión:', error);
    mensajeChecklist.textContent = '❌ No se pudo conectar con el servidor.';
    boton.disabled = false;
  }
});

// ---------------------------------------------------------------
// Cargar la OT y decidir qué se muestra según su etapa
// ---------------------------------------------------------------
function renderizar(datos) {
  ordenActual = datos.orden;
  const estado = ordenActual.estado;
  modoAmpliacion = false;
  mostrarOrden(ordenActual);
  tbody.innerHTML = '';
  recalcular();
  avisoForm.hidden = true;

  const antesDeReparar = ESTADOS_ANTES_DE_REPARAR.includes(estado);

  if (!datos.ampliacion && antesDeReparar) {
    // Primer presupuesto: todo se edita en el formulario
    form.hidden = false;
    tituloForm.textContent = 'Ítems del presupuesto';
    botonGuardar.textContent = 'Guardar presupuesto';
    seccionChecklist.hidden = true;
    if (datos.items.length === 0) {
      agregarFila({ tipo: 'REPUESTO' });
    } else {
      datos.items.forEach((item) => agregarFila(item));
    }
  } else if (datos.ampliacion && estado === 'EN_PRESUPUESTO') {
    // Ampliación: lo aprobado queda fijo; solo se editan los adicionales pendientes
    modoAmpliacion = true;
    form.hidden = false;
    tituloForm.textContent = 'Trabajos adicionales (fallas nuevas)';
    botonGuardar.textContent = 'Guardar trabajos adicionales';
    avisoForm.hidden = false;
    avisoForm.textContent =
      'La OT volvió de la reparación. Cargá acá los repuestos y la mano de obra de las fallas nuevas: ' +
      'quedarán pendientes hasta que el cliente decida. Si no hace falta ningún trabajo adicional, guardá sin ítems.';
    mostrarLista(datos, datos.items.filter((it) => it.estado_aprobacion !== 'PENDIENTE'));
    datos.items
      .filter((it) => it.estado_aprobacion === 'PENDIENTE')
      .forEach((item) => agregarFila(item));
  } else {
    // PRESUPUESTADO con ampliación, reparación y estados posteriores: solo se muestra la lista
    form.hidden = true;
    mostrarLista(datos, datos.items);
  }
}

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
      seccionChecklist.hidden = true;
      return;
    }
    renderizar(datos);
  } catch (error) {
    console.error('Error al cargar el presupuesto:', error);
    infoOt.textContent = '❌ No se pudo conectar con el servidor.';
    form.hidden = true;
    seccionChecklist.hidden = true;
  }
}

// ---------------------------------------------------------------
// Guardar: primer presupuesto (PUT /presupuesto) o adicionales (PUT /presupuesto/adicionales)
// ---------------------------------------------------------------
form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const filas = [...tbody.querySelectorAll('tr')];
  if (filas.length === 0 && !modoAmpliacion) {
    mensaje.textContent = '⚠️ Agregá al menos un ítem al presupuesto.';
    return;
  }

  const items = filas.map((tr) => ({
    tipo: tr.querySelector('.f-tipo').value,
    descripcion_repuesto: tr.querySelector('.f-desc').value.trim(),
    cantidad: tr.querySelector('.f-cant').value,
    precio_unitario: tr.querySelector('.f-precio').value
  }));

  const ruta = modoAmpliacion ? 'presupuesto/adicionales' : 'presupuesto';

  botonGuardar.disabled = true;
  mensaje.textContent = 'Guardando...';

  try {
    const respuesta = await fetch(`${API_URL}/${encodeURIComponent(numeroOt)}/${ruta}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items })
    });
    const resultado = await respuesta.json();

    if (!respuesta.ok) {
      mensaje.textContent = '❌ ' + resultado.error;
      return;
    }

    const textoOk = modoAmpliacion
      ? `✅ ${resultado.mensaje} Estado de la OT: ${resultado.estado}.`
      : `✅ Presupuesto guardado (${resultado.cantidad_items} ítems, total ${formatoMoneda.format(resultado.total)}). ` +
        `Estado de la OT: ${resultado.estado}.`;

    await cargarPresupuesto(); // vuelve a dibujar la página con el estado actualizado
    if (form.hidden) {
      // Tras guardar adicionales el formulario se oculta: el aviso va junto a la lista
      mensajeChecklist.textContent = `${textoOk} ${mensajeChecklist.textContent}`;
    } else {
      mensaje.textContent = textoOk;
    }
  } catch (error) {
    console.error('Error al guardar el presupuesto:', error);
    mensaje.textContent = '❌ No se pudo conectar con el servidor.';
  } finally {
    botonGuardar.disabled = false;
  }
});

document.addEventListener('DOMContentLoaded', cargarPresupuesto);
