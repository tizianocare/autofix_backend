const express = require('express');
const mysql = require('mysql2');
const bodyParser = require('body-parser');

const app = express();

// Middleware para procesar los datos enviados desde el formulario HTML
app.use(bodyParser.urlencoded({ extended: true }));

// 1. Configuración de la conexión a MySQL
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',          // Tu usuario de MySQL
    password: '', // ⚠️ Reemplaza por tu contraseña de MySQL Workbench
    database: 'autofix_db'
});

db.connect((err) => {
    if (err) {
        console.error('Error al conectar a MySQL:', err.message);
        return;
    }
    console.log('Conectado exitosamente a la base de datos MySQL.');
});

// 2. Ruta que recibe el formulario
app.post('/guardar_ot', (req, res) => {
    // 1. Capturas el nuevo nombre del campo que viene desde el HTML
    const motivo = req.body.motivo_ingreso; 

    const numeroOT = 'OT-' + Date.now().toString().slice(-4);

    // 2. Usas la nueva columna en el INSERT
    const sql = `INSERT INTO ordenes_trabajo (numero_ot, cliente_id, vehiculo_id, motivo_ingreso) 
                 VALUES (?, 1, 1, ?)`;

    db.query(sql, [numeroOT, motivo], (err, result) => {
        if (err) {
            console.error('Error al ejecutar el INSERT:', err.message);
            return res.status(500).send('Error en la base de datos: ' + err.message);
        }
        res.send(`
            <h2>¡Orden de Trabajo Creada con Éxito!</h2>
            <p><strong>Número de OT:</strong> ${numeroOT}</p>
            <p><strong>Motivo de ingreso:</strong> ${motivo}</p>
        `);
    });
});

// 3. Iniciar el servidor en el puerto 3000
app.listen(3000, () => {
    console.log('Servidor activo en http://localhost:3000');
});