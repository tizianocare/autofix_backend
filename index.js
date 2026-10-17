const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// 🔗 1. Configuración de conexión a tu MySQL local
const pool = mysql.createPool({
  host: '127.0.0.1',
  user: 'root',         // Tu usuario de MySQL
  password: '',         // Tu contraseña de MySQL
  database: 'autofix_db'
});

// 🚀 2. Endpoint REST con Validaciones (Tarea 4)
app.post('/api/ordenes-trabajo', async (req, res) => {
  const { nombre_completo, telefono, patente, marca, modelo, fallas_reportadas } = req.body;

  // 🛡️ Expresiones Regulares para validación
  const regexPatente = /^[A-Z]{2}\d{3}[A-Z]{2}$/i; // Formato Mercosur: AA123CD
  const regexTelefono = /^\+?\d{7,15}$/;           // Solo números, '+' opcional al inicio

  // 1. Validar campos obligatorios
  if (!nombre_completo || !telefono || !patente || !marca || !modelo) {
    return res.status(400).json({ error: 'Todos los campos obligatorios deben estar completos.' });
  }

  // 2. Validar formato de Patente
  if (!regexPatente.test(patente)) {
    return res.status(400).json({ error: 'El formato de la patente es inválido (Ejemplo válido: AA123CD).' });
  }

  // 3. Validar formato de Teléfono
  if (!regexTelefono.test(telefono)) {
    return res.status(400).json({ error: 'El número de teléfono debe contener solo números (Ejemplo: +5491112345678).' });
  }

  // Transacción: si falla cualquier INSERT, no queda nada a medias en la BD
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Guardar Cliente
    const [resCliente] = await conn.query(
      'INSERT INTO clientes (nombre_completo, telefono) VALUES (?, ?)',
      [nombre_completo, telefono]
    );
    const cliente_id = resCliente.insertId;

    // Guardar Vehículo
    const [resVehiculo] = await conn.query(
      'INSERT INTO vehiculos (cliente_id, patente, marca, modelo) VALUES (?, ?, ?, ?)',
      [cliente_id, patente.toUpperCase(), marca, modelo]
    );
    const vehiculo_id = resVehiculo.insertId;

    // Generar N° de OT (clave primaria) y guardar Orden de Trabajo
    const numero_ot = `OT-${String(cliente_id).padStart(4, '0')}`;
    await conn.query(
      'INSERT INTO ordenes_trabajo (numero_ot, cliente_id, vehiculo_id, motivo_ingreso) VALUES (?, ?, ?, ?)',
      [numero_ot, cliente_id, vehiculo_id, fallas_reportadas || 'Sin observaciones']
    );

    await conn.commit();

    res.status(201).json({
      mensaje: '¡Orden de Trabajo creada con éxito!',
      numero_ot,
      cliente_id,
      vehiculo_id
    });
  } catch (error) {
    await conn.rollback();
    console.error('Error al guardar en BD:', error);

    // La patente es UNIQUE en la tabla vehiculos
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Ya existe un vehículo registrado con esa patente.' });
    }
    res.status(500).json({ error: 'Hubo un error interno al guardar la orden' });
  } finally {
    conn.release();
  }
});

// 🔍 Endpoint GET para listar todas las OT ingresadas
app.get('/api/ordenes-trabajo', async (req, res) => {
  try {
    const query = `
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
      ORDER BY ot.fecha_ingreso DESC
    `;

    const [filas] = await pool.query(query);
    res.json(filas);
  } catch (error) {
    console.error('Error al consultar las OTs:', error);
    res.status(500).json({ error: 'Error al obtener la lista de órdenes de trabajo' });
  }
});

// 🟢 3. Iniciar el servidor
app.listen(3000, () => {
  console.log('Servidor corriendo en http://localhost:3000');
});
