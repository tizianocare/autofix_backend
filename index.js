const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ---------------------------------------------------------------
// 1. Conexión a MySQL (configurable por variables de entorno)
// ---------------------------------------------------------------
const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '', // ⚠️ poné tu contraseña o usá DB_PASSWORD
  database: process.env.DB_NAME || 'autofix_db',
  waitForConnections: true,
  connectionLimit: 10
});

// ---------------------------------------------------------------
// 2. Archivos del frontend (solo los necesarios, no el código del server)
// ---------------------------------------------------------------
const archivosPublicos = ['panel.html', 'nueva_ot.html', 'app.js'];
archivosPublicos.forEach((archivo) => {
  app.get('/' + archivo, (req, res) => res.sendFile(path.join(__dirname, archivo)));
});
app.get('/', (req, res) => res.redirect('/panel.html'));

// ---------------------------------------------------------------
// 3. Validaciones
// ---------------------------------------------------------------
// Acepta patente Mercosur (AA123CD) y formato anterior (ABC123)
const regexPatente = /^([A-Z]{2}\d{3}[A-Z]{2}|[A-Z]{3}\d{3})$/;
const regexTelefono = /^\+?\d{7,15}$/;
const ESTADOS = ['INGRESADO', 'EN_DIAGNOSTICO', 'PRESUPUESTADO', 'EN_REPARACION', 'LISTO_PARA_RETIRAR', 'ENTREGADO'];

// ---------------------------------------------------------------
// 4. POST: crear Orden de Trabajo (cliente + vehículo + OT en una transacción)
// ---------------------------------------------------------------
app.post('/api/ordenes-trabajo', async (req, res) => {
  const nombre = String(req.body.nombre_completo ?? '').trim();
  const telefono = String(req.body.telefono ?? '').replace(/[\s-]/g, '');
  const patente = String(req.body.patente ?? '').replace(/\s/g, '').toUpperCase();
  const marca = String(req.body.marca ?? '').trim();
  const modelo = String(req.body.modelo ?? '').trim();
  // Acepta ambos nombres de campo; en la BD la columna es motivo_ingreso (NOT NULL)
  const motivo = String(req.body.fallas_reportadas ?? req.body.motivo_ingreso ?? '').trim() || 'Sin observaciones';

  if (!nombre || !telefono || !patente || !marca || !modelo) {
    return res.status(400).json({ error: 'Todos los campos obligatorios deben estar completos.' });
  }
  if (!regexPatente.test(patente)) {
    return res.status(400).json({ error: 'El formato de la patente es inválido (Ejemplos válidos: AA123CD o ABC123).' });
  }
  if (!regexTelefono.test(telefono)) {
    return res.status(400).json({ error: 'El teléfono debe contener solo números, con "+" opcional al inicio (Ejemplo: +5491112345678).' });
  }
  if (nombre.length > 120 || marca.length > 50 || modelo.length > 50) {
    return res.status(400).json({ error: 'Alguno de los campos supera la longitud máxima permitida.' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    let cliente_id;
    let vehiculo_id;
    let vehiculo_existente = false;

    // La patente es UNIQUE: si el vehículo ya existe, se reutiliza (con su cliente)
    const [vehiculos] = await conn.query(
      'SELECT id, cliente_id FROM vehiculos WHERE patente = ? FOR UPDATE',
      [patente]
    );

    if (vehiculos.length > 0) {
      vehiculo_id = vehiculos[0].id;
      cliente_id = vehiculos[0].cliente_id;
      vehiculo_existente = true;
    } else {
      const [resCliente] = await conn.query(
        'INSERT INTO clientes (nombre_completo, telefono) VALUES (?, ?)',
        [nombre, telefono]
      );
      cliente_id = resCliente.insertId;

      const [resVehiculo] = await conn.query(
        'INSERT INTO vehiculos (cliente_id, patente, marca, modelo) VALUES (?, ?, ?, ?)',
        [cliente_id, patente, marca, modelo]
      );
      vehiculo_id = resVehiculo.insertId;
    }

    // numero_ot es la PK (varchar): se genera correlativo OT-0001, OT-0002...
    // Si dos pedidos chocan en el mismo número, se reintenta con el siguiente.
    const [[{ siguiente }]] = await conn.query(
      `SELECT COALESCE(MAX(CAST(SUBSTRING(numero_ot, 4) AS UNSIGNED)), 0) + 1 AS siguiente
       FROM ordenes_trabajo`
    );

    let numero_ot = null;
    for (let intento = 0; intento < 5 && !numero_ot; intento++) {
      const candidato = `OT-${String(siguiente + intento).padStart(4, '0')}`;
      try {
        await conn.query(
          'INSERT INTO ordenes_trabajo (numero_ot, cliente_id, vehiculo_id, motivo_ingreso) VALUES (?, ?, ?, ?)',
          [candidato, cliente_id, vehiculo_id, motivo]
        );
        numero_ot = candidato;
      } catch (err) {
        if (err.code !== 'ER_DUP_ENTRY') throw err;
      }
    }
    if (!numero_ot) throw new Error('No se pudo generar un número de OT único.');

    await conn.commit();

    res.status(201).json({
      mensaje: '¡Orden de Trabajo creada con éxito!',
      numero_ot,
      cliente_id,
      vehiculo_id,
      vehiculo_existente
    });
  } catch (error) {
    await conn.rollback();
    console.error('Error al guardar en BD:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Esa patente acaba de ser registrada. Intentá de nuevo.' });
    }
    res.status(500).json({ error: 'Hubo un error interno al guardar la orden' });
  } finally {
    conn.release();
  }
});

// ---------------------------------------------------------------
// 5. GET: listar OTs (motivo_ingreso se devuelve como fallas_reportadas
//    para que app.js funcione sin cambios)
// ---------------------------------------------------------------
app.get('/api/ordenes-trabajo', async (req, res) => {
  try {
    const [filas] = await pool.query(`
      SELECT
        ot.numero_ot,
        c.nombre_completo AS cliente,
        c.telefono,
        v.patente,
        v.marca,
        v.modelo,
        ot.motivo_ingreso AS fallas_reportadas,
        ot.estado,
        ot.fecha_ingreso
      FROM ordenes_trabajo ot
      INNER JOIN clientes c ON ot.cliente_id = c.id
      INNER JOIN vehiculos v ON ot.vehiculo_id = v.id
      ORDER BY ot.fecha_ingreso DESC, ot.numero_ot DESC
    `);
    res.json(filas);
  } catch (error) {
    console.error('Error al consultar las OTs:', error);
    res.status(500).json({ error: 'Error al obtener la lista de órdenes de trabajo' });
  }
});

// ---------------------------------------------------------------
// 6. PATCH: cambiar el estado de una OT
// ---------------------------------------------------------------
app.patch('/api/ordenes-trabajo/:numero_ot/estado', async (req, res) => {
  const { estado } = req.body;
  if (!ESTADOS.includes(estado)) {
    return res.status(400).json({ error: `Estado inválido. Valores permitidos: ${ESTADOS.join(', ')}` });
  }
  try {
    const [resultado] = await pool.query(
      'UPDATE ordenes_trabajo SET estado = ? WHERE numero_ot = ?',
      [estado, req.params.numero_ot]
    );
    if (resultado.affectedRows === 0) {
      return res.status(404).json({ error: 'No existe una OT con ese número.' });
    }
    res.json({ mensaje: 'Estado actualizado', numero_ot: req.params.numero_ot, estado });
  } catch (error) {
    console.error('Error al actualizar el estado:', error);
    res.status(500).json({ error: 'Error al actualizar el estado de la orden' });
  }
});

// ---------------------------------------------------------------
// 7. Iniciar el servidor verificando antes la conexión a la BD
// ---------------------------------------------------------------
const PORT = process.env.PORT || 3000;
pool.query('SELECT 1')
  .then(() => {
    console.log('Conectado exitosamente a la base de datos MySQL.');
    app.listen(PORT, () => console.log(`Servidor corriendo en http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error('No se pudo conectar a MySQL:', err.message);
    process.exit(1);
  });
