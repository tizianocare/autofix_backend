const express = require('express');

const TIPOS = ['REPUESTO', 'MANO_DE_OBRA'];

// Flujo de estados (alineado con TRANSICIONES_PERMITIDAS de index.js):
// al guardar el presupuesto, solo una OT en EN_PRESUPUESTO pasa a PRESUPUESTADO.
// Antes de eso la OT debe avanzar por INGRESADO -> EN_DIAGNOSTICO -> DIAGNOSTICADO -> EN_PRESUPUESTO.
const ESTADO_PREVIO_A_PRESUPUESTO = 'EN_PRESUPUESTO';
// Estados en los que todavía no se puede presupuestar
const ESTADOS_ANTES_DE_PRESUPUESTAR = ['INGRESADO', 'EN_DIAGNOSTICO', 'DIAGNOSTICADO'];
// Desde que la reparación empieza, el presupuesto original queda fijo: sus ítems son el
// checklist del mecánico y reemplazarlos borraría el avance registrado.
const ESTADOS_SIN_EDICION = ['EN_REPARACION', 'REPARADO', 'ENTREGADO', 'CANCELADO'];
// Estados en los que se pueden cargar trabajos adicionales (ampliación del presupuesto)
const ESTADOS_PARA_AMPLIAR = ['EN_PRESUPUESTO', 'PRESUPUESTADO'];

const redondear2 = (n) => Math.round(n * 100) / 100;
const aCentavos = (n) => Math.round(n * 100);
const sumarCentavos = (items) =>
  items.reduce((acc, it) => acc + aCentavos(it.cantidad * it.precio_unitario), 0);

// Valida y normaliza la lista de ítems que llega del frontend.
// Con permitirVacio se acepta una lista sin ítems (ampliación sin trabajos nuevos).
function validarItems(items, { permitirVacio = false } = {}) {
  if (!Array.isArray(items)) {
    return { error: 'La lista de ítems es inválida.' };
  }
  if (items.length === 0) {
    return permitirVacio ? { items: [] } : { error: 'El presupuesto debe tener al menos un ítem.' };
  }
  if (items.length > 100) {
    return { error: 'El presupuesto no puede tener más de 100 ítems.' };
  }

  const limpios = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i] || {};
    const n = i + 1;
    const tipo = String(it.tipo ?? 'REPUESTO');
    const descripcion = String(it.descripcion_repuesto ?? '').trim();
    const cantidad = Number(it.cantidad);
    const precio = Number(it.precio_unitario);

    if (!TIPOS.includes(tipo)) {
      return { error: `Ítem ${n}: el tipo debe ser REPUESTO o MANO_DE_OBRA.` };
    }
    if (!descripcion || descripcion.length > 200) {
      return { error: `Ítem ${n}: la descripción es obligatoria (máximo 200 caracteres).` };
    }
    if (!Number.isFinite(cantidad) || cantidad <= 0 || cantidad > 99999) {
      return { error: `Ítem ${n}: la cantidad debe ser un número mayor a 0.` };
    }
    if (!Number.isFinite(precio) || precio < 0 || precio > 9999999999) {
      return { error: `Ítem ${n}: el precio unitario debe ser un número mayor o igual a 0.` };
    }

    limpios.push({
      tipo,
      descripcion,
      cantidad: redondear2(cantidad),
      precio: redondear2(precio)
    });
  }
  return { items: limpios };
}

// Una OT está en "ampliación" si ya pasó por la reparación y volvió a diagnóstico/presupuesto
async function esAmpliacion(db, numero_ot) {
  const [[fila]] = await db.query(
    `SELECT COUNT(*) AS n
     FROM historial_estados
     WHERE numero_ot = ? AND (estado_nuevo = 'EN_REPARACION' OR estado_anterior = 'EN_REPARACION')`,
    [numero_ot]
  );
  return Number(fila.n) > 0;
}

module.exports = function crearRutasPresupuesto(pool) {
  const router = express.Router();

  // -------------------------------------------------------------
  // GET /api/ordenes-trabajo/:numero_ot/presupuesto
  // Devuelve la OT, todos sus ítems (con su estado de aprobación),
  // el total aprobado, el total pendiente de decisión y el progreso del checklist.
  // -------------------------------------------------------------
  router.get('/:numero_ot/presupuesto', async (req, res) => {
    try {
      const [ots] = await pool.query(
        `SELECT
           ot.numero_ot,
           ot.estado,
           ot.motivo_ingreso AS fallas_reportadas,
           ot.diagnostico_tecnico,
           c.nombre_completo AS cliente,
           c.telefono,
           v.patente,
           v.marca,
           v.modelo
         FROM ordenes_trabajo ot
         INNER JOIN clientes c ON ot.cliente_id = c.id
         INNER JOIN vehiculos v ON ot.vehiculo_id = v.id
         WHERE ot.numero_ot = ?`,
        [req.params.numero_ot]
      );
      if (ots.length === 0) {
        return res.status(404).json({ error: 'No existe una OT con ese número.' });
      }

      const [filas] = await pool.query(
        `SELECT id, tipo, descripcion_repuesto, cantidad, precio_unitario,
                completado, fecha_completado, adicional, estado_aprobacion
         FROM detalles_presupuesto
         WHERE numero_ot = ?
         ORDER BY id`,
        [req.params.numero_ot]
      );

      // MySQL devuelve los DECIMAL como texto: se convierten a número
      const items = filas.map((f) => ({
        id: f.id,
        tipo: f.tipo,
        descripcion_repuesto: f.descripcion_repuesto,
        cantidad: Number(f.cantidad),
        precio_unitario: Number(f.precio_unitario),
        completado: Boolean(f.completado),
        fecha_completado: f.fecha_completado,
        adicional: Boolean(f.adicional),
        estado_aprobacion: f.estado_aprobacion
      }));

      // El total y el checklist cuentan solo lo aprobado; lo pendiente se informa aparte
      const aprobados = items.filter((it) => it.estado_aprobacion === 'APROBADO');
      const pendientes = items.filter((it) => it.estado_aprobacion === 'PENDIENTE');
      const progreso = {
        completados: aprobados.filter((it) => it.completado).length,
        total: aprobados.length
      };

      const ampliacion =
        ots[0].estado === 'EN_REPARACION' || (await esAmpliacion(pool, req.params.numero_ot));

      res.json({
        orden: ots[0],
        items,
        total: sumarCentavos(aprobados) / 100,
        total_pendiente: sumarCentavos(pendientes) / 100,
        progreso,
        ampliacion
      });
    } catch (error) {
      console.error('Error al obtener el presupuesto:', error);
      res.status(500).json({ error: 'Error al obtener el presupuesto de la orden' });
    }
  });

  // -------------------------------------------------------------
  // PUT /api/ordenes-trabajo/:numero_ot/presupuesto
  // Primer presupuesto de la OT: reemplaza todos los ítems y la pasa a PRESUPUESTADO.
  // (todo en una transacción: o se guarda completo o no se guarda nada)
  // -------------------------------------------------------------
  router.put('/:numero_ot/presupuesto', async (req, res) => {
    const numero_ot = req.params.numero_ot;
    const validacion = validarItems(req.body.items);
    if (validacion.error) {
      return res.status(400).json({ error: validacion.error });
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [ots] = await conn.query(
        'SELECT estado FROM ordenes_trabajo WHERE numero_ot = ? FOR UPDATE',
        [numero_ot]
      );
      if (ots.length === 0) {
        await conn.rollback();
        return res.status(404).json({ error: 'No existe una OT con ese número.' });
      }
      if (ESTADOS_SIN_EDICION.includes(ots[0].estado)) {
        await conn.rollback();
        return res.status(409).json({ error: `El presupuesto ya no se puede modificar: la OT está en estado ${ots[0].estado}.` });
      }
      if (ESTADOS_ANTES_DE_PRESUPUESTAR.includes(ots[0].estado)) {
        await conn.rollback();
        return res.status(409).json({ error: 'Primero pasá la OT a EN_PRESUPUESTO desde el panel para poder presupuestarla.' });
      }
      if (await esAmpliacion(conn, numero_ot)) {
        await conn.rollback();
        return res.status(409).json({
          error: 'El presupuesto original ya fue aprobado y no se modifica. Cargá las fallas nuevas como trabajos adicionales.'
        });
      }

      // Se borran los ítems anteriores y se insertan los nuevos
      await conn.query('DELETE FROM detalles_presupuesto WHERE numero_ot = ?', [numero_ot]);

      const filas = validacion.items.map((it) => [
        numero_ot, it.tipo, it.descripcion, it.cantidad, it.precio
      ]);
      await conn.query(
        `INSERT INTO detalles_presupuesto
           (numero_ot, tipo, descripcion_repuesto, cantidad, precio_unitario)
         VALUES ?`,
        [filas]
      );

      // Cambio de estado de la OT
      let estadoFinal = ots[0].estado;
      if (estadoFinal === ESTADO_PREVIO_A_PRESUPUESTO) {
        await conn.query(
          "UPDATE ordenes_trabajo SET estado = 'PRESUPUESTADO' WHERE numero_ot = ?",
          [numero_ot]
        );
        // Trazabilidad (Tarjeta 3.1): el cambio automático también queda en el historial
        await conn.query(
          'INSERT INTO historial_estados (numero_ot, estado_anterior, estado_nuevo) VALUES (?, ?, ?)',
          [numero_ot, estadoFinal, 'PRESUPUESTADO']
        );
        estadoFinal = 'PRESUPUESTADO';
      }

      await conn.commit();

      const totalCentavos = validacion.items.reduce(
        (acc, it) => acc + aCentavos(it.cantidad * it.precio),
        0
      );

      res.json({
        mensaje: 'Presupuesto guardado',
        numero_ot,
        estado: estadoFinal,
        cantidad_items: validacion.items.length,
        total: totalCentavos / 100
      });
    } catch (error) {
      await conn.rollback();
      console.error('Error al guardar el presupuesto:', error);
      res.status(500).json({ error: 'Error al guardar el presupuesto' });
    } finally {
      conn.release();
    }
  });

  // -------------------------------------------------------------
  // PUT /api/ordenes-trabajo/:numero_ot/presupuesto/adicionales
  // Ampliación del presupuesto: fallas nuevas encontradas durante la reparación.
  // Reemplaza solo los adicionales que todavía están PENDIENTES de decisión; los ítems
  // aprobados (con su checklist) y los ya decididos no se tocan.
  // Con la OT en EN_PRESUPUESTO la pasa a PRESUPUESTADO. Se permite no cargar ítems
  // (si finalmente no hace falta ningún trabajo adicional).
  // -------------------------------------------------------------
  router.put('/:numero_ot/presupuesto/adicionales', async (req, res) => {
    const numero_ot = req.params.numero_ot;
    const validacion = validarItems(req.body.items, { permitirVacio: true });
    if (validacion.error) {
      return res.status(400).json({ error: validacion.error });
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [ots] = await conn.query(
        'SELECT estado FROM ordenes_trabajo WHERE numero_ot = ? FOR UPDATE',
        [numero_ot]
      );
      if (ots.length === 0) {
        await conn.rollback();
        return res.status(404).json({ error: 'No existe una OT con ese número.' });
      }
      if (!ESTADOS_PARA_AMPLIAR.includes(ots[0].estado)) {
        await conn.rollback();
        return res.status(409).json({
          error: `Los trabajos adicionales se cargan con la OT en EN_PRESUPUESTO (estado actual: ${ots[0].estado}).`
        });
      }
      if (!(await esAmpliacion(conn, numero_ot))) {
        await conn.rollback();
        return res.status(409).json({
          error: 'Esta OT todavía no inició la reparación: usá el presupuesto normal.'
        });
      }

      await conn.query(
        `DELETE FROM detalles_presupuesto
         WHERE numero_ot = ? AND adicional = 1 AND estado_aprobacion = 'PENDIENTE'`,
        [numero_ot]
      );

      if (validacion.items.length > 0) {
        const filas = validacion.items.map((it) => [
          numero_ot, it.tipo, it.descripcion, it.cantidad, it.precio, 1, 'PENDIENTE'
        ]);
        await conn.query(
          `INSERT INTO detalles_presupuesto
             (numero_ot, tipo, descripcion_repuesto, cantidad, precio_unitario, adicional, estado_aprobacion)
           VALUES ?`,
          [filas]
        );
      }

      let estadoFinal = ots[0].estado;
      if (estadoFinal === ESTADO_PREVIO_A_PRESUPUESTO) {
        await conn.query(
          "UPDATE ordenes_trabajo SET estado = 'PRESUPUESTADO' WHERE numero_ot = ?",
          [numero_ot]
        );
        await conn.query(
          'INSERT INTO historial_estados (numero_ot, estado_anterior, estado_nuevo) VALUES (?, ?, ?)',
          [numero_ot, estadoFinal, 'PRESUPUESTADO']
        );
        estadoFinal = 'PRESUPUESTADO';
      }

      await conn.commit();

      const totalCentavos = validacion.items.reduce(
        (acc, it) => acc + aCentavos(it.cantidad * it.precio),
        0
      );

      res.json({
        mensaje: validacion.items.length > 0
          ? 'Trabajos adicionales guardados: quedan pendientes de la decisión del cliente.'
          : 'No hay trabajos adicionales: la OT puede continuar con el presupuesto original.',
        numero_ot,
        estado: estadoFinal,
        cantidad_items: validacion.items.length,
        total_pendiente: totalCentavos / 100
      });
    } catch (error) {
      await conn.rollback();
      console.error('Error al guardar los trabajos adicionales:', error);
      res.status(500).json({ error: 'Error al guardar los trabajos adicionales' });
    } finally {
      conn.release();
    }
  });

  // -------------------------------------------------------------
  // PATCH /api/ordenes-trabajo/:numero_ot/presupuesto/items/:item_id/decision
  // Registra la decisión del cliente sobre un trabajo adicional: APROBADO o RECHAZADO.
  // Solo con la OT en PRESUPUESTADO (mientras no empiece a reparar).
  // Los aprobados se suman al total y al checklist; los rechazados quedan como registro.
  // -------------------------------------------------------------
  router.patch('/:numero_ot/presupuesto/items/:item_id/decision', async (req, res) => {
    const { numero_ot } = req.params;
    const item_id = Number(req.params.item_id);
    const { decision } = req.body;

    if (!['APROBADO', 'RECHAZADO'].includes(decision)) {
      return res.status(400).json({ error: 'La decisión debe ser APROBADO o RECHAZADO.' });
    }
    if (!Number.isInteger(item_id) || item_id <= 0) {
      return res.status(400).json({ error: 'El identificador del ítem es inválido.' });
    }

    try {
      const [ots] = await pool.query(
        'SELECT estado FROM ordenes_trabajo WHERE numero_ot = ?',
        [numero_ot]
      );
      if (ots.length === 0) {
        return res.status(404).json({ error: 'No existe una OT con ese número.' });
      }
      if (ots[0].estado !== 'PRESUPUESTADO') {
        return res.status(409).json({
          error: `La decisión del cliente se registra con la OT en PRESUPUESTADO (estado actual: ${ots[0].estado}).`
        });
      }

      const [resultado] = await pool.query(
        `UPDATE detalles_presupuesto
         SET estado_aprobacion = ?
         WHERE id = ? AND numero_ot = ? AND adicional = 1`,
        [decision, item_id, numero_ot]
      );
      if (resultado.affectedRows === 0) {
        return res.status(404).json({ error: 'Ese trabajo adicional no existe en esta OT.' });
      }

      const [[conteo]] = await pool.query(
        `SELECT COALESCE(SUM(estado_aprobacion = 'PENDIENTE'), 0) AS sin_decision
         FROM detalles_presupuesto
         WHERE numero_ot = ?`,
        [numero_ot]
      );

      res.json({
        mensaje: decision === 'APROBADO' ? 'Trabajo adicional aprobado' : 'Trabajo adicional rechazado',
        item_id,
        decision,
        sin_decision: Number(conteo.sin_decision) // SUM devuelve texto: se convierte
      });
    } catch (error) {
      console.error('Error al registrar la decisión del cliente:', error);
      res.status(500).json({ error: 'Error al registrar la decisión del cliente' });
    }
  });

  // -------------------------------------------------------------
  // PATCH /api/ordenes-trabajo/:numero_ot/presupuesto/items/:item_id
  // Marca o desmarca un ítem APROBADO como realizado (checklist de reparación).
  // Solo mientras la OT está EN_REPARACION.
  // -------------------------------------------------------------
  router.patch('/:numero_ot/presupuesto/items/:item_id', async (req, res) => {
    const { numero_ot } = req.params;
    const item_id = Number(req.params.item_id);
    const { completado } = req.body;

    if (typeof completado !== 'boolean') {
      return res.status(400).json({ error: 'El campo completado debe ser true o false.' });
    }
    if (!Number.isInteger(item_id) || item_id <= 0) {
      return res.status(400).json({ error: 'El identificador del ítem es inválido.' });
    }

    try {
      const [ots] = await pool.query(
        'SELECT estado FROM ordenes_trabajo WHERE numero_ot = ?',
        [numero_ot]
      );
      if (ots.length === 0) {
        return res.status(404).json({ error: 'No existe una OT con ese número.' });
      }
      if (ots[0].estado !== 'EN_REPARACION') {
        return res.status(409).json({ error: 'El checklist solo se puede modificar mientras la OT está EN_REPARACION.' });
      }

      const marca = completado ? 1 : 0;
      const [resultado] = await pool.query(
        `UPDATE detalles_presupuesto
         SET completado = ?, fecha_completado = IF(?, NOW(), NULL)
         WHERE id = ? AND numero_ot = ? AND estado_aprobacion = 'APROBADO'`,
        [marca, marca, item_id, numero_ot]
      );
      if (resultado.affectedRows === 0) {
        return res.status(404).json({ error: 'Ese ítem no existe en el checklist de esta OT (o todavía no fue aprobado).' });
      }

      // SUM devuelve texto en MySQL: se convierte a número
      const [[conteo]] = await pool.query(
        `SELECT COUNT(*) AS total, COALESCE(SUM(completado), 0) AS completados
         FROM detalles_presupuesto
         WHERE numero_ot = ? AND estado_aprobacion = 'APROBADO'`,
        [numero_ot]
      );

      res.json({
        mensaje: completado ? 'Ítem marcado como realizado' : 'Ítem desmarcado',
        item_id,
        completado,
        progreso: { completados: Number(conteo.completados), total: Number(conteo.total) }
      });
    } catch (error) {
      console.error('Error al actualizar el checklist:', error);
      res.status(500).json({ error: 'Error al actualizar el ítem del checklist' });
    }
  });

  return router;
};
