const express = require('express');

const TIPOS = ['REPUESTO', 'MANO_DE_OBRA'];
// Flujo de estados (alineado con TRANSICIONES_PERMITIDAS de index.js):
// al guardar el presupuesto, solo una OT en DIAGNOSTICO pasa a PRESUPUESTADO.
// Una OT en INGRESADO primero debe avanzar a DIAGNOSTICO; las cerradas no se editan.
const ESTADO_PREVIO_A_PRESUPUESTO = 'DIAGNOSTICO';
// Desde que la reparación empieza, el presupuesto queda fijo: sus ítems son el checklist
// del mecánico (Tarjeta 3.3) y reemplazarlos borraría el avance registrado.
const ESTADOS_SIN_EDICION = ['EN_REPARACION', 'LISTO', 'ENTREGADO', 'CANCELADO'];

const redondear2 = (n) => Math.round(n * 100) / 100;
const aCentavos = (n) => Math.round(n * 100);

// Valida y normaliza la lista de ítems que llega del frontend
function validarItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return { error: 'El presupuesto debe tener al menos un ítem.' };
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

module.exports = function crearRutasPresupuesto(pool) {
  const router = express.Router();

  // -------------------------------------------------------------
  // GET /api/ordenes-trabajo/:numero_ot/presupuesto
  // Devuelve los datos de la OT, su presupuesto actual y el total
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
                completado, fecha_completado
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
        fecha_completado: f.fecha_completado
      }));
      const progreso = {
        completados: items.filter((it) => it.completado).length,
        total: items.length
      };
      const totalCentavos = items.reduce(
        (acc, it) => acc + aCentavos(it.cantidad * it.precio_unitario),
        0
      );

      res.json({ orden: ots[0], items, total: totalCentavos / 100, progreso });
    } catch (error) {
      console.error('Error al obtener el presupuesto:', error);
      res.status(500).json({ error: 'Error al obtener el presupuesto de la orden' });
    }
  });

  // -------------------------------------------------------------
  // PUT /api/ordenes-trabajo/:numero_ot/presupuesto
  // Reemplaza todo el presupuesto de la OT y la pasa a PRESUPUESTADO
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
      if (ots[0].estado === 'INGRESADO') {
        await conn.rollback();
        return res.status(409).json({ error: 'Primero pasá la OT a DIAGNOSTICO desde el panel para poder presupuestarla.' });
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
  // PATCH /api/ordenes-trabajo/:numero_ot/presupuesto/items/:item_id
  // Marca o desmarca un ítem del presupuesto como realizado
  // (Sprint 3 - Tarjeta 3.3). Solo mientras la OT está EN_REPARACION.
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
         WHERE id = ? AND numero_ot = ?`,
        [marca, marca, item_id, numero_ot]
      );
      if (resultado.affectedRows === 0) {
        return res.status(404).json({ error: 'Ese ítem no existe en el presupuesto de esta OT.' });
      }

      // SUM devuelve texto en MySQL: se convierte a número
      const [[conteo]] = await pool.query(
        `SELECT COUNT(*) AS total, COALESCE(SUM(completado), 0) AS completados
         FROM detalles_presupuesto
         WHERE numero_ot = ?`,
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

module.exports = function crearRutasPresupuesto(pool) {
  const router = express.Router();

  // -------------------------------------------------------------
  // GET /api/ordenes-trabajo/:numero_ot/presupuesto
  // Devuelve los datos de la OT, su presupuesto actual y el total
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
        `SELECT id, tipo, descripcion_repuesto, cantidad, precio_unitario
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
        precio_unitario: Number(f.precio_unitario)
      }));
      const totalCentavos = items.reduce(
        (acc, it) => acc + aCentavos(it.cantidad * it.precio_unitario),
        0
      );

      res.json({ orden: ots[0], items, total: totalCentavos / 100 });
    } catch (error) {
      console.error('Error al obtener el presupuesto:', error);
      res.status(500).json({ error: 'Error al obtener el presupuesto de la orden' });
    }
  });

  // -------------------------------------------------------------
  // PUT /api/ordenes-trabajo/:numero_ot/presupuesto
  // Reemplaza todo el presupuesto de la OT y la pasa a PRESUPUESTADO
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
        return res.status(409).json({ error: `No se puede modificar el presupuesto de una OT en estado ${ots[0].estado}.` });
      }
      if (ots[0].estado === 'INGRESADO') {
        await conn.rollback();
        return res.status(409).json({ error: 'Primero pasá la OT a DIAGNOSTICO desde el panel para poder presupuestarla.' });
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

  return router;
};
