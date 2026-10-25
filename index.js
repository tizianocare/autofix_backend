const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
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
   const archivosPublicos = ['panel.html', 'nueva_ot.html', 'app.js', 'presupuesto.html', 'presupuesto.js'];
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
        ot.diagnostico_tecnico,
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
// 5.1 PUT: guardar el diagnóstico técnico de una OT (Sprint 2 - Tarjeta 2.1)
// ---------------------------------------------------------------
app.put('/api/ordenes-trabajo/:numero_ot/diagnostico', async (req, res) => {
  const diagnostico = String(req.body.diagnostico_tecnico ?? '').trim();

  if (!diagnostico) {
    return res.status(400).json({ error: 'El diagnóstico técnico no puede estar vacío.' });
  }
  if (diagnostico.length > 5000) {
    return res.status(400).json({ error: 'El diagnóstico supera el máximo de 5000 caracteres.' });
  }

  try {
    const [resultado] = await pool.query(
      'UPDATE ordenes_trabajo SET diagnostico_tecnico = ? WHERE numero_ot = ?',
      [diagnostico, req.params.numero_ot]
    );
    if (resultado.affectedRows === 0) {
      return res.status(404).json({ error: 'No existe una OT con ese número.' });
    }
    res.json({ mensaje: 'Diagnóstico guardado', numero_ot: req.params.numero_ot });
  } catch (error) {
    console.error('Error al guardar el diagnóstico:', error);
    res.status(500).json({ error: 'Error al guardar el diagnóstico técnico' });
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

// Sprint 2 - Tarjeta 2.3: presupuesto de la OT
app.use('/api/ordenes-trabajo', require('./rutas_presupuesto')(pool));

// Transiciones permitidas (sin saltos ilógicos)
const TRANSICIONES_PERMITIDAS = {
    'INGRESADO': ['DIAGNOSTICO', 'CANCELADO'],
    'DIAGNOSTICO': ['PRESUPUESTADO', 'CANCELADO'],
    'PRESUPUESTADO': ['EN_REPARACION', 'CANCELADO'],
    'EN_REPARACION': ['LISTO', 'CANCELADO'],
    'LISTO': ['ENTREGADO'],
    'ENTREGADO': [],
    'CANCELADO': []
};

// 🔄 Endpoint PATCH: Cambiar estado con validación e historial
app.patch('/api/ordenes-trabajo/:numero_ot/estado', async (req, res) => {
    const { numero_ot } = req.params;
    const { nuevo_estado } = req.body;

    if (!nuevo_estado) {
        return res.status(400).json({ error: 'El campo nuevo_estado es obligatorio.' });
    }

    try {
        // 1. Obtener estado actual
        const [ots] = await pool.query(
            'SELECT estado FROM ordenes_trabajo WHERE numero_ot = ?',
            [numero_ot]
        );

        if (ots.length === 0) {
            return res.status(404).json({ error: 'Orden de Trabajo no encontrada.' });
        }

        const estado_actual = ots[0].estado;

        // 2. Validar que la transición sea permitida
        const permitidos = TRANSICIONES_PERMITIDAS[estado_actual] || [];
        if (!permitidos.includes(nuevo_estado)) {
            return res.status(400).json({ 
                error: `Transición inválida: No se puede cambiar de '${estado_actual}' a '${nuevo_estado}'.` 
            });
        }

        // 3. Actualizar estado en ordenes_trabajo
        await pool.query(
            'UPDATE ordenes_trabajo SET estado = ? WHERE numero_ot = ?',
            [nuevo_estado, numero_ot]
        );

        // 4. Guardar registro en la tabla historial_estados
        await pool.query(
            'INSERT INTO historial_estados (numero_ot, estado_anterior, estado_nuevo) VALUES (?, ?, ?)',
            [numero_ot, estado_actual, nuevo_estado]
        );

        res.json({ 
            mensaje: `Estado de ${numero_ot} actualizado con éxito a '${nuevo_estado}'.`, 
            numero_ot, 
            estado_anterior: estado_actual, 
            nuevo_estado 
        });

    } catch (error) {
        console.error('Error al actualizar estado:', error);
        res.status(500).json({ error: 'Error interno al procesar el cambio de estado.' });
    }
});

// ---------------------------------------------------------------
// 👨‍🔧 TARJETA 3.2: Asignación de Mecánicos y Filtros
// ---------------------------------------------------------------

// 1. Endpoint para listar mecánicos activos
app.get('/api/mecanicos', async (req, res) => {
    try {
        const [mecanicos] = await pool.query('SELECT id, nombre FROM mecanicos WHERE activo = TRUE ORDER BY nombre ASC');
        res.json(mecanicos);
    } catch (error) {
        console.error('Error al obtener mecánicos:', error);
        res.status(500).json({ error: 'Error al obtener la lista de mecánicos.' });
    }
});

// 2. Endpoint PATCH para asignar/cambiar mecánico en una OT
app.patch('/api/ordenes-trabajo/:numero_ot/mecanico', async (req, res) => {
    const { numero_ot } = req.params;
    const { mecanico_id } = req.body; // Puede ser un ID de mecánico o null para quitar asignación

    try {
        const [ots] = await pool.query('SELECT numero_ot FROM ordenes_trabajo WHERE numero_ot = ?', [numero_ot]);
        
        if (ots.length === 0) {
            return res.status(404).json({ error: 'Orden de trabajo no encontrada.' });
        }

        await pool.query(
            'UPDATE ordenes_trabajo SET mecanico_id = ? WHERE numero_ot = ?',
            [mecanico_id || null, numero_ot]
        );

        res.json({ 
            mensaje: `Mecánico actualizado correctamente para la OT ${numero_ot}.`, 
            numero_ot, 
            mecanico_id: mecanico_id || null 
        });
    } catch (error) {
        console.error('Error al asignar mecánico:', error);
        res.status(500).json({ error: 'Error interno al asignar el mecánico.' });
    }
});

// 3. Reemplazar o actualizar GET /api/ordenes-trabajo para incluir JOIN con mecánicos y filtros (por estado y mecánico)
app.get('/api/ordenes-trabajo', async (req, res) => {
    const { estado, mecanico_id } = req.query;

    try {
        let sql = `
            SELECT ot.*, m.nombre AS mecanico_nombre 
            FROM ordenes_trabajo ot 
            LEFT JOIN mecanicos m ON ot.mecanico_id = m.id 
            WHERE 1=1
        `;
        const params = [];

        if (estado) {
            sql += ' AND ot.estado = ?';
            params.push(estado);
        }

        if (mecanico_id) {
            sql += ' AND ot.mecanico_id = ?';
            params.push(mecanico_id);
        }

        sql += ' ORDER BY ot.id DESC';

        const [filas] = await pool.query(sql, params);
        res.json(filas);
    } catch (error) {
        console.error('Error al obtener órdenes de trabajo:', error);
        res.status(500).json({ error: 'Error al obtener las órdenes de trabajo.' });
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

// ---------------------------------------------------------------
// 8. Multer y el Endpoint para subir evidencia multimedia (Sprint 2 - Tarjeta 2.2)
// ---------------------------------------------------------------

// 📂 1. Servir la carpeta 'uploads' como archivos estáticos
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Asegurar que la carpeta 'uploads' exista
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// ⚙️ 2. Configuración de almacenamiento de Multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        // Generar un nombre único: ot_timestamp_nombreoriginal
        const ot = req.body.numero_ot || 'evidencia';
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, `${ot}_${uniqueSuffix}${ext}`);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 } // Límite de 10 MB por archivo
});

// 📸 3. Endpoint POST para subir evidencia multimedia
app.post('/api/evidencias', upload.single('archivo'), async (req, res) => {
    const { numero_ot } = req.body;
    
    if (!numero_ot) {
        return res.status(400).json({ error: 'El campo numero_ot es obligatorio.' });
    }
    
    if (!req.file) {
        return res.status(400).json({ error: 'No se seleccionó ningún archivo de imagen o video.' });
    }

    // Ruta relativa que se guardará en la base de datos (ej: /uploads/OT-0001_169700000.jpg)
    const url_archivo = `/uploads/${req.file.filename}`;

    try {
        const query = 'INSERT INTO evidencias_multimedia (numero_ot, url_archivo) VALUES (?, ?)';
        await pool.query(query, [numero_ot, url_archivo]);
        
        res.status(201).json({
            mensaje: '¡Evidencia multimedia subida y asociada con éxito!',
            numero_ot,
            url_archivo
        });
    } catch (error) {
        console.error('Error al guardar evidencia en la BD:', error);
        res.status(500).json({ error: 'Error interno al asociar la evidencia.' });
    }
});

