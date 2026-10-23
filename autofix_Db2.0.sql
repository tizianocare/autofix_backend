CREATE DATABASE autofix_db;
USE autofix_db;

-- 1. Tabla de Clientes
CREATE TABLE clientes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre_completo VARCHAR(120) NOT NULL,
    telefono VARCHAR(20) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Tabla de Vehículos
CREATE TABLE vehiculos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    cliente_id INT NOT NULL,
    patente VARCHAR(10) NOT NULL UNIQUE,
    marca VARCHAR(50) NOT NULL,
    modelo VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_vehiculo_cliente
        FOREIGN KEY (cliente_id)
        REFERENCES clientes(id)
        ON DELETE CASCADE
);

-- 3. Tabla de Órdenes de Trabajo (OT)
CREATE TABLE ordenes_trabajo (
    numero_ot VARCHAR(20) PRIMARY KEY,
    cliente_id INT NOT NULL,
    vehiculo_id INT NOT NULL,
    motivo_ingreso TEXT NOT NULL,
    diagnostico_tecnico TEXT NULL,  -- Sprint 2 (Tarjeta 2.1)
    estado ENUM('INGRESADO', 'EN_DIAGNOSTICO', 'PRESUPUESTADO', 'EN_REPARACION', 'LISTO_PARA_RETIRAR', 'ENTREGADO') DEFAULT 'INGRESADO',
    fecha_ingreso TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    -- Relaciones
    CONSTRAINT fk_ot_cliente
        FOREIGN KEY (cliente_id)
        REFERENCES clientes(id),
    CONSTRAINT fk_ot_vehiculo
        FOREIGN KEY (vehiculo_id)
        REFERENCES vehiculos(id)
);

-- 4. Tabla de Evidencias Multimedia (Sprint 2 - Tarjeta 2.2)
CREATE TABLE IF NOT EXISTS evidencias_multimedia (
    id INT AUTO_INCREMENT PRIMARY KEY,
    numero_ot VARCHAR(20) NOT NULL,
    url_archivo VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (numero_ot) REFERENCES ordenes_trabajo(numero_ot) ON DELETE CASCADE
);

-- 5. Tabla de Detalle del Presupuesto (Sprint 2 - Tarjeta 2.3)
CREATE TABLE IF NOT EXISTS detalles_presupuesto (
    id INT AUTO_INCREMENT PRIMARY KEY,
    numero_ot VARCHAR(20) NOT NULL,
    tipo ENUM('REPUESTO', 'MANO_DE_OBRA') NOT NULL DEFAULT 'REPUESTO',
    descripcion_repuesto VARCHAR(200) NOT NULL,
    cantidad DECIMAL(10,2) NOT NULL DEFAULT 1.00,      -- unidades (repuestos) u horas (mano de obra)
    precio_unitario DECIMAL(12,2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_detalle_ot
        FOREIGN KEY (numero_ot)
        REFERENCES ordenes_trabajo(numero_ot)
        ON DELETE CASCADE
);
