const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// 🔗 1. Configura aquí los datos de TU MySQL local
const pool = mysql.createPool({
  host: '127.0.0.1',
  user: 'root',         // Tu usuario de MySQL
  password: '', // Tu contraseña de MySQL
  database: 'autofix_db'  // El nombre de la BD que creaste
});

// 🚀 2. Endpoint REST (Ruta POST para guardar la Orden de Trabajo)
app.post('/api/ordenes-trabajo', async (req, res) => {
  const { nombre_completo, telefono, patente, marca, modelo, fallas_reportadas } = req.body;

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
      [numero_ot, cliente_id, vehiculo_id, fallas_reportadas]
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
    res.status(500).json({ error: 'Hubo un error al guardar la orden' });
  }
});

// 🟢 3. Iniciar el servidor
app.listen(3000, () => {
  console.log('Servidor corriendo en http://localhost:3000');
});