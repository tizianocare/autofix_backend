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
  password: '', // Tu contraseña de MySQL
  database: 'autofix_db'  // La base de datos del proyecto
});

// 🚀 2. Endpoint REST con Validaciones (Tarea 4)
app.post('/api/ordenes-trabajo', async (req, res) => {
  const { nombre_completo, telefono, patente, marca, modelo, fallas_reportadas } = req.body;

  // 🛡️ Expresiones Regulares para validación
  const regexPatente = /^[A-Z]{2}\d{3}[A-Z]{2}$/i; // Formato Mercosur: 2 letras, 3 números, 2 letras (ej: AA123CD)
  const regexTelefono = /^\+?\d{7,15}$/;           // Solo números, opcional el signo '+' al inicio (ej: +5491112345678)

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

  try {
    // Guardar Cliente
    const [resCliente] = await pool.query(
      'INSERT INTO clientes (nombre_completo, telefono) VALUES (?, ?)',
      [nombre_completo, telefono]
    );
    const cliente_id = resCliente.insertId;

    // Guardar Vehículo
    const [resVehiculo] = await pool.query(
      'INSERT INTO vehiculos (cliente_id, patente, marca, modelo) VALUES (?, ?, ?, ?)',
      [cliente_id, patente.toUpperCase(), marca, modelo]
    );
    const vehiculo_id = resVehiculo.insertId;

    // Generar N° de OT y guardar Orden de Trabajo
    const numero_ot = `OT-${String(resCliente.insertId).padStart(4, '0')}`;
    const [resOT] = await pool.query(
      'INSERT INTO ordenes_trabajo (numero_ot, cliente_id, vehiculo_id, fallas_reportadas) VALUES (?, ?, ?, ?)',
      [numero_ot, cliente_id, vehiculo_id, fallas_reportadas || 'Sin observaciones']
    );

    res.status(201).json({
      mensaje: '¡Orden de Trabajo creada con éxito!',
      numero_ot,
      cliente_id,
      vehiculo_id,
      ot_id: resOT.insertId
    });
  } catch (error) {
    console.error('Error al guardar en BD:', error);
    res.status(500).json({ error: 'Hubo un error interno al guardar la orden' });
  }
});

// 🔍 Endpoint GET para listar todas las OT ingresadas (sin fecha_creacion)
app.get('/api/ordenes-trabajo', async (req, res) => {
  try {
    const query = `
      SELECT 
        ot.id AS ot_id, 
        ot.numero_ot, 
        c.nombre_completo AS cliente, 
        c.telefono, 
        v.patente, 
        v.marca, 
        v.modelo, 
        ot.fallas_reportadas, 
        ot.estado 
      FROM ordenes_trabajo ot 
      INNER JOIN clientes c ON ot.cliente_id = c.id 
      INNER JOIN vehiculos v ON ot.vehiculo_id = v.id
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