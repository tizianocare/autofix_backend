CREATE DATABASE autofix_db;
USE autofix_db;

-- 1\. Tabla de Clientes
CREATE TABLE clientes ( 
	id INT AUTO_INCREMENT PRIMARY KEY, 
    nombre_completo VARCHAR(120) NOT NULL, 
    telefono VARCHAR(20) NOT NULL, 
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP 
);

-- 2\. Tabla de Vehículos
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

-- 3\. Tabla de Órdenes de Trabajo (OT)
CREATE TABLE ordenes_trabajo ( 
	numero_ot varchar(20) PRIMARY KEY, 
    cliente_id INT NOT NULL, 
    vehiculo_id INT NOT NULL, 
    motivo_ingreso TEXT NOT NULL, 
    estado ENUM('INGRESADO', 'EN_DIAGNOSTICO', 'PRESUPUESTADO', 'EN_REPARACION', 'LISTO_PARA_RETIRAR', 'ENTREGADO') DEFAULT 'INGRESADO', 
    fecha_ingreso TIMESTAMP DEFAULT CURRENT_TIMESTAMP, 
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, 
		
-- Relaciones 
	CONSTRAINT fk_ot_cliente 
		FOREIGN KEY (cliente_id) 
		REFERENCES clientes(id), 
    CONSTRAINT fk_ot_vehiculo 
		FOREIGN KEY (vehiculo_id) 
		REFERENCES vehiculos(id));