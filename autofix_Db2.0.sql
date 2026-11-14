-- AutoFix Manager - Esquema completo (instalación desde cero)
-- Incluye Sprints 1, 2 y 3 (flujo de estados, ampliación del presupuesto y historial de diagnósticos).
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

-- 3. Tabla de Mecánicos (Sprint 3 - Tarjeta 3.2)
CREATE TABLE mecanicos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL UNIQUE,
    activo BOOLEAN DEFAULT TRUE
);

-- 4. Tabla de Órdenes de Trabajo (OT)
CREATE TABLE ordenes_trabajo (
    numero_ot VARCHAR(20) PRIMARY KEY,
    cliente_id INT NOT NULL,
    vehiculo_id INT NOT NULL,
    mecanico_id INT NULL,                -- Sprint 3 (Tarjeta 3.2)
    motivo_ingreso TEXT NOT NULL,
    diagnostico_tecnico TEXT NULL,       -- Sprint 2 (Tarjeta 2.1)
    -- Sprint 3 (Tarjeta 3.1): estados del flujo del taller. Cada etapa tiene su versión
    -- «en curso» (EN_...) y «ya pasó» (...ADO), y el trabajo se cierra con ENTREGADO o CANCELADO.
    estado ENUM('INGRESADO', 'EN_DIAGNOSTICO', 'DIAGNOSTICADO', 'EN_PRESUPUESTO', 'PRESUPUESTADO', 'EN_REPARACION', 'REPARADO', 'ENTREGADO', 'CANCELADO') DEFAULT 'INGRESADO',
    fecha_ingreso TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_entrega TIMESTAMP NULL DEFAULT NULL,   -- Sprint 3 (Tarjeta 3.4)
    observaciones_entrega TEXT NULL,             -- Sprint 3 (Tarjeta 3.4)
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    -- Relaciones
    CONSTRAINT fk_ot_cliente
        FOREIGN KEY (cliente_id)
        REFERENCES clientes(id),
    CONSTRAINT fk_ot_vehiculo
        FOREIGN KEY (vehiculo_id)
        REFERENCES vehiculos(id),
    CONSTRAINT fk_ot_mecanico
        FOREIGN KEY (mecanico_id)
        REFERENCES mecanicos(id)
        ON DELETE SET NULL
);

-- 5. Tabla de Evidencias Multimedia (Sprint 2 - Tarjeta 2.2)
CREATE TABLE evidencias_multimedia (
    id INT AUTO_INCREMENT PRIMARY KEY,
    numero_ot VARCHAR(20) NOT NULL,
    url_archivo VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (numero_ot) REFERENCES ordenes_trabajo(numero_ot) ON DELETE CASCADE
);

-- 6. Tabla de Detalle del Presupuesto (Sprint 2 - Tarjeta 2.3)
CREATE TABLE detalles_presupuesto (
    id INT AUTO_INCREMENT PRIMARY KEY,
    numero_ot VARCHAR(20) NOT NULL,
    tipo ENUM('REPUESTO', 'MANO_DE_OBRA') NOT NULL DEFAULT 'REPUESTO',
    descripcion_repuesto VARCHAR(200) NOT NULL,
    cantidad DECIMAL(10,2) NOT NULL DEFAULT 1.00,      -- unidades (repuestos) u horas (mano de obra)
    precio_unitario DECIMAL(12,2) NOT NULL,
    completado BOOLEAN NOT NULL DEFAULT FALSE,          -- Sprint 3 (Tarjeta 3.3): checklist de reparación
    fecha_completado TIMESTAMP NULL DEFAULT NULL,       -- Sprint 3 (Tarjeta 3.3)
    -- Ampliación del presupuesto (fallas nuevas durante la reparación):
    adicional BOOLEAN NOT NULL DEFAULT FALSE,           -- TRUE si se agregó después de empezar la reparación
    estado_aprobacion ENUM('PENDIENTE', 'APROBADO', 'RECHAZADO') NOT NULL DEFAULT 'APROBADO',  -- decisión del cliente
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_detalle_ot
        FOREIGN KEY (numero_ot)
        REFERENCES ordenes_trabajo(numero_ot)
        ON DELETE CASCADE
);

-- 7. Historial de cambios de estado (Sprint 3 - Tarjeta 3.1)
CREATE TABLE historial_estados (
    id INT AUTO_INCREMENT PRIMARY KEY,
    numero_ot VARCHAR(20) NOT NULL,
    estado_anterior VARCHAR(50) NOT NULL,
    estado_nuevo VARCHAR(50) NOT NULL,
    fecha_cambio TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_historial_ot
        FOREIGN KEY (numero_ot)
        REFERENCES ordenes_trabajo(numero_ot)
        ON DELETE CASCADE
);

-- 8. Historial de diagnósticos (cada diagnóstico queda registrado, no se pisa el anterior)
CREATE TABLE historial_diagnosticos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    numero_ot VARCHAR(20) NOT NULL,
    diagnostico TEXT NOT NULL,
    fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_hist_diag_ot
        FOREIGN KEY (numero_ot)
        REFERENCES ordenes_trabajo(numero_ot)
        ON DELETE CASCADE
);

-- Datos iniciales: mecánicos de prueba (INSERT IGNORE evita duplicados gracias al UNIQUE)
INSERT IGNORE INTO mecanicos (nombre, activo)
VALUES
    ('Carlos Gómez', TRUE),
    ('Roberto Martínez', TRUE),
    ('Lucía Fernández', TRUE);
