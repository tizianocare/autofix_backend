const express = require('express');

const TIPOS = ['REPUESTO', 'MANO_DE_OBRA'];
// Flujo de estados (alineado con TRANSICIONES_PERMITIDAS de index.js):
// al guardar el presupuesto, solo una OT en DIAGNOSTICO pasa a PRESUPUESTADO.
// Una OT en INGRESADO primero debe avanzar a DIAGNOSTICO; las cerradas no se editan.
const ESTADO_PREVIO_A_PRESUPUESTO = 'DIAGNOSTICO';
const ESTADOS_SIN_EDICION = ['ENTREGADO', 'CANCELADO'];

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
