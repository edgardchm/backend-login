const cors = require('cors');
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('./db'); // db exporta el pool de pg
require('dotenv').config();

const app = express();

app.use(express.json());
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

const SECRET_KEY = process.env.JWT_SECRET || 'clave_por_defecto';

// Middleware para verificar el token JWT
function verificarToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Token no proporcionado' });
  }

  jwt.verify(token, SECRET_KEY, (err, user) => {
    if (err) return res.status(403).json({ error: 'Token inválido' });
    req.user = user;
    next();
  });
}

// =================== LOGIN ===================
app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await db.query('SELECT * FROM usuarios WHERE email = $1', [email]);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    }

    const user = result.rows[0];

    const match = await bcrypt.compare(password, user.password_hash);

    if (!match) {
      return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    }

    // Crear JWT
    const token = jwt.sign(
      { id: user.id, email: user.email, rol: user.rol, nombre: user.nombre },
      SECRET_KEY,
      { expiresIn: '8h' }
    );

    res.status(200).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        nombre: user.nombre,
        rol: user.rol
      }
    });

  } catch (err) {
    console.error('Error en login:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// =================== FORGOT PASSWORD (SIN AUTENTICACIÓN) ===================
// Endpoint para cambiar contraseña sin autenticación (usando solo email)
app.put('/usuarios/forgot-password', async (req, res) => {
  console.log('🔓 Endpoint forgot-password llamado - NO requiere autenticación');
  console.log('📧 Email recibido:', req.body.email);
  
  const { email, nueva_password, confirmar_password } = req.body;

  try {
    // Validar que se envíen todos los campos requeridos
    if (!email || !nueva_password || !confirmar_password) {
      return res.status(400).json({ 
        error: 'Se requieren los campos email, nueva_password y confirmar_password' 
      });
    }

    // Validar formato de email básico
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ 
        error: 'Formato de email inválido' 
      });
    }

    // Validar que las contraseñas coincidan
    if (nueva_password !== confirmar_password) {
      return res.status(400).json({ 
        error: 'Las contraseñas no coinciden' 
      });
    }

    // Validar longitud mínima de contraseña
    if (nueva_password.length < 6) {
      return res.status(400).json({ 
        error: 'La contraseña debe tener al menos 6 caracteres' 
      });
    }

    // Verificar que el usuario existe
    const usuarioCheck = await db.query('SELECT id, nombre, email FROM usuarios WHERE email = $1', [email]);
    if (usuarioCheck.rows.length === 0) {
      return res.status(404).json({ 
        error: 'No existe un usuario con ese email' 
      });
    }

    // Encriptar la nueva contraseña
    const saltRounds = 10;
    const nueva_password_hash = await bcrypt.hash(nueva_password, saltRounds);

    // Actualizar la contraseña en la base de datos
    const result = await db.query(
      `UPDATE usuarios 
       SET password_hash = $1, actualizado_en = NOW() 
       WHERE email = $2
       RETURNING id, nombre, email, rol`,
      [nueva_password_hash, email]
    );

    res.json({ 
      message: 'Contraseña actualizada exitosamente',
      usuario: {
        id: result.rows[0].id,
        nombre: result.rows[0].nombre,
        email: result.rows[0].email,
        rol: result.rows[0].rol
      }
    });

  } catch (error) {
    console.error('Error al cambiar contraseña:', error);
    res.status(500).json({ 
      error: 'Error al cambiar la contraseña',
      detalle: error.message 
    });
  }
});

// =================== TIPO DE REPUESTOS ===================
app.get('/repuestos', verificarToken, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM tipos_repuestos ORDER BY nombre');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener los tipos de repuestos' });
  }
});

app.post('/repuestos', verificarToken, async (req, res) => {
  const { nombre } = req.body;

  try {
    const tipoResult = await db.query(
      'INSERT INTO tipos_repuestos (nombre) VALUES ($1) RETURNING id',
      [nombre]
    );

    const tipoRepuestoId = tipoResult.rows[0].id;

    await db.query(
      'INSERT INTO marca_tipo_repuesto (marca_id, tipo_repuesto_id) SELECT id, $1 FROM marcas ON CONFLICT DO NOTHING',
      [tipoRepuestoId]
    );

    res.json({ message: 'Tipo de repuesto creado y vinculado a todas las marcas', tipoRepuestoId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear el tipo de repuesto' });
  }
});

app.delete('/repuestos/:id', verificarToken, async (req, res) => {
  const { id } = req.params;
  try {
    // Verificar si el tipo de repuesto existe
    const tipoCheck = await db.query('SELECT id, nombre FROM tipos_repuestos WHERE id = $1', [id]);
    if (tipoCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Tipo de repuesto no encontrado' });
    }

    // Verificar si hay repuestos que usan este tipo
    const repuestosCheck = await db.query('SELECT COUNT(*) as count FROM repuestos WHERE tipo_repuesto_id = $1', [id]);
    const repuestosCount = parseInt(repuestosCheck.rows[0].count);
    
    if (repuestosCount > 0) {
      return res.status(400).json({ 
        error: 'No se puede eliminar el tipo de repuesto',
        detalle: `Existen ${repuestosCount} repuestos que usan este tipo. Elimine primero los repuestos asociados.`,
        tipo_repuesto: tipoCheck.rows[0].nombre,
        repuestos_asociados: repuestosCount
      });
    }

    // Verificar si hay relaciones en marca_tipo_repuesto
    const marcaTipoCheck = await db.query('SELECT COUNT(*) as count FROM marca_tipo_repuesto WHERE tipo_repuesto_id = $1', [id]);
    const marcaTipoCount = parseInt(marcaTipoCheck.rows[0].count);
    
    if (marcaTipoCount > 0) {
      // Eliminar las relaciones primero
      await db.query('DELETE FROM marca_tipo_repuesto WHERE tipo_repuesto_id = $1', [id]);
    }

    // Ahora eliminar el tipo de repuesto
    await db.query('DELETE FROM tipos_repuestos WHERE id = $1', [id]);
    
    res.json({ 
      message: 'Tipo de repuesto eliminado exitosamente',
      tipo_eliminado: {
        id: parseInt(id),
        nombre: tipoCheck.rows[0].nombre
      }
    });
  } catch (err) {
    console.error('Error detallado al eliminar tipo de repuesto:', err);
    res.status(500).json({ 
      error: 'Error al eliminar el tipo de repuesto',
      detalle: err.message,
      codigo: err.code
    });
  }
});

// =================== MARCAS ===================
app.get('/marcas', verificarToken, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM marcas ORDER BY marca');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener las marcas' });
  }
});

app.post('/marcas', verificarToken, async (req, res) => {
  const { marca } = req.body;
  try {
    const result = await db.query(
      'INSERT INTO marcas (marca) VALUES ($1) RETURNING *',
      [marca]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al agregar la marca' });
  }
});

app.put('/marcas/:id', verificarToken, async (req, res) => {
  const { id } = req.params;
  const { marca } = req.body;
  try {
    const result = await db.query(
      'UPDATE marcas SET marca = $1 WHERE id = $2 RETURNING *',
      [marca, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al editar la marca' });
  }
});

app.delete('/marcas/:id', verificarToken, async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('DELETE FROM marcas WHERE id = $1', [id]);
    res.json({ message: 'Marca eliminada' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar la marca' });
  }
});

// =================== REPUESTOS ===================
const generarSKU = (nombreTipo, nombreMarca) => {
  const tipo = nombreTipo.slice(0, 3).toUpperCase();
  const marca = nombreMarca.slice(0, 3).toUpperCase();
  const random = Math.floor(1000 + Math.random() * 9000);
  return `${tipo}-${marca}-${random}`;
};

app.get('/repuestos-marca', verificarToken, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT r.*, m.marca, tr.nombre AS tipo
      FROM repuestos r
      JOIN marcas m ON r.marca_id = m.id
      JOIN tipos_repuestos tr ON r.tipo_repuesto_id = tr.id
      ORDER BY tr.nombre, m.marca, r.nombre
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener los repuestos' });
  }
});

// Función para crear repuesto (reutilizable)
const crearRepuesto = async (req, res) => {
  const { nombre, descripcion, precio, precio_mayor, precio_cliente, tipo_repuesto_id, marca_id, stock } = req.body;

  try {
    const tipoRes = await db.query('SELECT nombre FROM tipos_repuestos WHERE id = $1', [tipo_repuesto_id]);
    const marcaRes = await db.query('SELECT marca FROM marcas WHERE id = $1', [marca_id]);

    if (tipoRes.rows.length === 0 || marcaRes.rows.length === 0) {
      return res.status(400).json({ error: 'Tipo o Marca no encontrada' });
    }

    const sku = generarSKU(tipoRes.rows[0].nombre, marcaRes.rows[0].marca);

    const result = await db.query(
      `INSERT INTO repuestos 
        (nombre, descripcion, precio, precio_mayor, precio_cliente, tipo_repuesto_id, marca_id, sku, stock)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [nombre, descripcion, precio, precio_mayor, precio_cliente, tipo_repuesto_id, marca_id, sku, stock]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error al crear el repuesto:', err);
    res.status(500).json({ error: 'Error al crear el repuesto' });
  }
};

// Endpoint con guión (original)
app.post('/repuestos-marca', verificarToken, crearRepuesto);

// Endpoint con barra (nuevo para compatibilidad)
app.post('/repuestos/marca', verificarToken, crearRepuesto);

app.delete('/repuestos-marca/:id', verificarToken, async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('DELETE FROM repuestos WHERE id = $1', [id]);
    res.json({ message: 'Repuesto eliminado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar el repuesto' });
  }
});

app.get('/repuestos/:tipoRepuestoId/:marcaId', verificarToken, async (req, res) => {
  const { tipoRepuestoId, marcaId } = req.params;
  try {
    const result = await db.query(`
      SELECT id, nombre, precio_mayor, precio_cliente, stock, sku
      FROM repuestos
      WHERE tipo_repuesto_id = $1 AND marca_id = $2
      ORDER BY nombre
    `, [tipoRepuestoId, marcaId]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener los repuestos' });
  }
});

// =================== MARCAS POR TIPO ===================
app.get('/marcas-por-tipo/:tipoRepuestoId', verificarToken, async (req, res) => {
  const { tipoRepuestoId } = req.params;
  try {
    const result = await db.query(`
      SELECT m.id, m.marca, t.nombre AS tipo_repuesto
      FROM marcas m
      JOIN marca_tipo_repuesto mt ON m.id = mt.marca_id
      JOIN tipos_repuestos t ON mt.tipo_repuesto_id = t.id
      WHERE t.id = $1
    `, [tipoRepuestoId]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener las marcas' });
  }
});


// =================== PRODUCTOS TOTALES (CANTIDAD EN STOCK) ===================

app.get('/productos/total', verificarToken, async (req, res) => {
  try {
    const query = `SELECT COUNT(*) AS total FROM productos`;
    const result = await db.query(query);
    res.json({ total: parseInt(result.rows[0].total, 10) });
  } catch (error) {
    console.error('Error obteniendo total de productos:', error);
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

// =================== PRODUCTOS ===================
app.get('/productos/:busqueda', verificarToken, async (req, res) => {
  const { busqueda } = req.params;

  try {
    const query = `
      SELECT p.*, 
             m.marca AS marca, 
             t.nombre AS tipo
      FROM productos p
      LEFT JOIN marcas m ON p.marca_id = m.id
      LEFT JOIN tipos_producto t ON p.tipo_id = t.id
      WHERE p.sku = $1
         OR p.sku LIKE $3 
         OR p.nombre ILIKE $2
      ORDER BY 
        CASE 
          WHEN p.sku = $1 THEN 1
          WHEN p.sku LIKE $3 THEN 2
          ELSE 3
        END,
        p.nombre
    `;

    const searchPattern = `%${busqueda}%`;
    const skuPattern = `%${busqueda}%`;
    const result = await db.query(query, [busqueda, searchPattern, skuPattern]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'No se encontraron productos con esa búsqueda' });
    }

    // Si solo hay un resultado exacto por SKU, devolver solo ese
    if (result.rows.length === 1 && result.rows[0].sku === busqueda) {
      return res.json(result.rows[0]);
    }

    // Si hay múltiples resultados, devolver el array
    res.json({
      total: result.rows.length,
      productos: result.rows,
      busqueda: busqueda
    });
  } catch (error) {
    console.error('Error consultando productos:', error);
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

// =================== PRODUCTOS CON PAGINACIÓN Y CRUD ===================

// Endpoint de prueba para verificar la conexión a la base de datos
app.get('/productos/test', verificarToken, async (req, res) => {
  try {
    // Query simple para verificar que la tabla existe
    const testQuery = `
      SELECT 
        COUNT(*) as total_productos,
        COUNT(DISTINCT marca_id) as total_marcas,
        COUNT(DISTINCT tipo_id) as total_tipos
      FROM productos
    `;
    
    const result = await db.query(testQuery);
    
    res.json({
      message: 'Conexión a base de datos exitosa',
      estadisticas: result.rows[0],
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error en test de productos:', error);
    res.status(500).json({ 
      error: 'Error en test de productos',
      detalle: error.message,
      stack: error.stack
    });
  }
});

// Endpoint SIMPLIFICADO para productos
app.get('/productos', verificarToken, async (req, res) => {
  try {
    console.log('🚀 Endpoint /productos llamado');
    
    const {
      pagina = 1,
      por_pagina = 10,
      ordenar_por = 'nombre',
      orden = 'asc',
      busqueda = '',
      marca_id,
      tipo_id
    } = req.query;
    
    console.log('📋 Parámetros recibidos:', { pagina, por_pagina, ordenar_por, orden, busqueda, marca_id, tipo_id });
    
    // Validar parámetros
    const offset = (parseInt(pagina) - 1) * parseInt(por_pagina);
    const ordenesValidos = ['nombre', 'sku', 'precio_cliente', 'precio_mayorista', 'stock'];
    const direccionesValidas = ['asc', 'desc'];
    
    if (!ordenesValidos.includes(ordenar_por)) {
      return res.status(400).json({ 
        error: `Campo de ordenamiento inválido. Válidos: ${ordenesValidos.join(', ')}` 
      });
    }
    
    if (!direccionesValidas.includes(orden.toLowerCase())) {
      return res.status(400).json({ 
        error: 'Dirección de ordenamiento inválida. Use: asc o desc' 
      });
    }
    
    // Construir filtros
    let whereConditions = [];
    let queryParams = [];
    let paramCount = 1;
    
    if (busqueda) {
      whereConditions.push(`p.nombre ILIKE $${paramCount}`);
      queryParams.push(`%${busqueda}%`);
      paramCount++;
    }
    
    if (marca_id) {
      whereConditions.push(`p.marca_id = $${paramCount}`);
      queryParams.push(marca_id);
      paramCount++;
    }
    
    if (tipo_id) {
      whereConditions.push(`p.tipo_id = $${paramCount}`);
      queryParams.push(tipo_id);
      paramCount++;
    }
    
    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
    
    // Query principal con las columnas reales - SIN LÍMITE FIJO
    const query = `
      SELECT 
        p.id,
        p.sku,
        p.nombre,
        p.precio_cliente,
        p.precio_mayorista,
        p.marca_id,
        p.tipo_id,
        p.stock,
        m.marca,
        t.nombre AS tipo
      FROM productos p
      LEFT JOIN marcas m ON p.marca_id = m.id
      LEFT JOIN tipos_producto t ON p.tipo_id = t.id
      ${whereClause}
      ORDER BY p.${ordenar_por} ${orden.toUpperCase()}
      LIMIT $${paramCount} OFFSET $${paramCount + 1}
    `;
    
    console.log('🔍 Query construida:', query);
    console.log('🔍 Parámetros:', queryParams);
    
    // Agregar parámetros de paginación
    queryParams.push(parseInt(por_pagina), offset);
    
    const result = await db.query(query, queryParams);
    console.log('✅ Query ejecutada, filas obtenidas:', result.rows.length);
    
    // Query para contar total
    const countQuery = `
      SELECT COUNT(*) as total
      FROM productos p
      LEFT JOIN marcas m ON p.marca_id = m.id
      LEFT JOIN tipos_producto t ON p.tipo_id = t.id
      ${whereClause}
    `;
    
    const countResult = await db.query(countQuery, whereConditions.length > 0 ? queryParams.slice(0, -2) : []);
    const totalRegistros = parseInt(countResult.rows[0].total);
    
    res.json({
      productos: result.rows,
      paginacion: {
        pagina: parseInt(pagina),
        por_pagina: parseInt(por_pagina),
        total: totalRegistros,
        total_paginas: Math.ceil(totalRegistros / parseInt(por_pagina))
      },
      filtros: {
        busqueda,
        marca_id,
        tipo_id,
        ordenar_por,
        orden
      }
    });
    
  } catch (error) {
    console.error('❌ Error en endpoint /productos:', error);
    res.status(500).json({ 
      error: 'Error al obtener productos',
      detalle: error.message,
      stack: error.stack
    });
  }
});

// Crear nuevo producto
app.post('/productos', verificarToken, async (req, res) => {
  try {
    const {
      nombre,
      sku,
      precio_cliente,
      precio_mayorista,
      marca_id,
      tipo_id,
      stock = 0
    } = req.body;

    // Validar campos requeridos
    if (!nombre || !sku || !precio_cliente) {
      return res.status(400).json({ error: 'Nombre, SKU y precio_cliente son campos requeridos' });
    }

    // Verificar si el SKU ya existe
    const skuCheck = await db.query('SELECT id FROM productos WHERE sku = $1', [sku]);
    if (skuCheck.rows.length > 0) {
      return res.status(400).json({ error: 'El SKU ya existe' });
    }

    // Insertar producto
    const result = await db.query(`
      INSERT INTO productos (nombre, sku, precio_cliente, precio_mayorista, marca_id, tipo_id, stock)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [nombre, sku, precio_cliente, precio_mayorista, marca_id, tipo_id, stock]);

    // Obtener producto con información de marca y tipo
    const productoCompleto = await db.query(`
      SELECT p.*, m.marca AS marca, t.nombre AS tipo
      FROM productos p
      LEFT JOIN marcas m ON p.marca_id = m.id
      LEFT JOIN tipos_producto t ON p.tipo_id = t.id
      WHERE p.id = $1
    `, [result.rows[0].id]);

    res.status(201).json({
      message: 'Producto creado exitosamente',
      producto: productoCompleto.rows[0]
    });

  } catch (error) {
    console.error('Error creando producto:', error);
    res.status(500).json({ error: 'Error al crear el producto' });
  }
});

// Obtener producto por ID
app.get('/productos/id/:id', verificarToken, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(`
      SELECT p.*, m.marca AS marca, t.nombre AS tipo
      FROM productos p
      LEFT JOIN marcas m ON p.marca_id = m.id
      LEFT JOIN tipos_producto t ON p.tipo_id = t.id
      WHERE p.id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    res.json(result.rows[0]);

  } catch (error) {
    console.error('Error obteniendo producto:', error);
    res.status(500).json({ error: 'Error al obtener el producto' });
  }
});

// Actualizar producto
app.put('/productos/:id', verificarToken, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      nombre,
      sku,
      precio_cliente,
      precio_mayorista,
      marca_id = null,
      tipo_id = null,
      stock
    } = req.body;

    console.log('📦 Actualizando producto:', { id, nombre, sku, precio_cliente, precio_mayorista, stock });

    // Verificar si el producto existe
    const productoCheck = await db.query('SELECT id FROM productos WHERE id = $1', [id]);
    if (productoCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    // Verificar si el SKU ya existe en otro producto
    if (sku) {
      const skuCheck = await db.query('SELECT id FROM productos WHERE sku = $1 AND id != $2', [sku, id]);
      if (skuCheck.rows.length > 0) {
        return res.status(400).json({ error: 'El SKU ya existe en otro producto' });
      }
    }

    // Actualizar producto
    console.log('🔍 Ejecutando UPDATE con parámetros:', { nombre, sku, precio_cliente, precio_mayorista, marca_id, tipo_id, stock, id });
    
    // Construir la consulta dinámicamente solo con los campos que se están enviando
    let updateFields = [];
    let updateValues = [];
    let paramCount = 1;

    if (nombre !== undefined) {
      updateFields.push(`nombre = $${paramCount}`);
      updateValues.push(nombre);
      paramCount++;
    }
    
    if (sku !== undefined) {
      updateFields.push(`sku = $${paramCount}`);
      updateValues.push(sku);
      paramCount++;
    }
    
    if (precio_cliente !== undefined) {
      updateFields.push(`precio_cliente = $${paramCount}`);
      updateValues.push(precio_cliente);
      paramCount++;
    }
    
    if (precio_mayorista !== undefined) {
      updateFields.push(`precio_mayorista = $${paramCount}`);
      updateValues.push(precio_mayorista);
      paramCount++;
    }
    
    if (marca_id !== null && marca_id !== undefined) {
      updateFields.push(`marca_id = $${paramCount}`);
      updateValues.push(marca_id);
      paramCount++;
    }
    
    if (tipo_id !== null && tipo_id !== undefined) {
      updateFields.push(`tipo_id = $${paramCount}`);
      updateValues.push(tipo_id);
      paramCount++;
    }
    
    if (stock !== undefined) {
      updateFields.push(`stock = $${paramCount}`);
      updateValues.push(stock);
      paramCount++;
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No hay campos para actualizar' });
    }

    updateValues.push(id); // Agregar el ID al final

    const updateQuery = `
      UPDATE productos 
      SET ${updateFields.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *
    `;

    console.log('🔍 Query final:', updateQuery);
    console.log('🔍 Valores:', updateValues);

    const result = await db.query(updateQuery, updateValues);

    console.log('✅ Producto actualizado exitosamente:', result.rows[0]);

    // Obtener producto actualizado con información de marca y tipo
    const productoCompleto = await db.query(`
      SELECT p.*, m.marca AS marca, t.nombre AS tipo
      FROM productos p
      LEFT JOIN marcas m ON p.marca_id = m.id
      LEFT JOIN tipos_producto t ON p.tipo_id = t.id
      WHERE p.id = $1
    `, [id]);

    res.json({
      message: 'Producto actualizado exitosamente',
      producto: productoCompleto.rows[0]
    });

  } catch (error) {
    console.error('❌ Error actualizando producto:', error);
    console.error('❌ Detalles del error:', {
      message: error.message,
      code: error.code,
      detail: error.detail,
      stack: error.stack
    });
    res.status(500).json({ 
      error: 'Error al actualizar el producto',
      detalle: error.message,
      codigo: error.code
    });
  }
});

// Actualizar stock de producto
app.patch('/productos/:id/stock', verificarToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { stock, operacion } = req.body;

    console.log('📦 Actualizando stock para producto:', { id, stock, operacion });

    // Validar campos requeridos
    if (stock === undefined || stock === null) {
      return res.status(400).json({ error: 'El campo stock es requerido' });
    }

    if (operacion && !['agregar', 'quitar', 'establecer'].includes(operacion)) {
      return res.status(400).json({ error: 'La operación debe ser: agregar, quitar o establecer' });
    }

    // Verificar si el producto existe y obtener stock actual
    const productoCheck = await db.query('SELECT id, nombre, sku, stock FROM productos WHERE id = $1', [id]);
    if (productoCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    const producto = productoCheck.rows[0];
    const stockActual = parseInt(producto.stock) || 0;
    let nuevoStock;

    // Calcular nuevo stock según la operación
    if (operacion === 'agregar') {
      nuevoStock = stockActual + parseInt(stock);
    } else if (operacion === 'quitar') {
      nuevoStock = Math.max(0, stockActual - parseInt(stock)); // No permitir stock negativo
    } else {
      // operacion === 'establecer' o sin operación (por defecto)
      nuevoStock = parseInt(stock);
    }

    console.log('📊 Cálculo de stock:', { stockActual, nuevoStock, operacion });

    // Actualizar stock
    const result = await db.query(`
      UPDATE productos 
      SET stock = $1
      WHERE id = $2
      RETURNING *
    `, [nuevoStock, id]);

    console.log('✅ Stock actualizado exitosamente');

    res.json({
      message: 'Stock actualizado exitosamente',
      producto: {
        id: producto.id,
        nombre: producto.nombre,
        sku: producto.sku,
        stock_anterior: stockActual,
        stock_nuevo: nuevoStock,
        operacion: operacion || 'establecer',
        cantidad_cambiada: operacion === 'agregar' ? parseInt(stock) : 
                          operacion === 'quitar' ? -parseInt(stock) : 
                          nuevoStock - stockActual
      }
    });

  } catch (error) {
    console.error('❌ Error actualizando stock:', error);
    console.error('❌ Detalles del error:', {
      message: error.message,
      code: error.code,
      detail: error.detail,
      stack: error.stack
    });
    res.status(500).json({ 
      error: 'Error al actualizar el stock',
      detalle: error.message,
      codigo: error.code
    });
  }
});

// Eliminar producto
app.delete('/productos/:id', verificarToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Verificar si el producto existe
    const productoCheck = await db.query('SELECT id, nombre, sku FROM productos WHERE id = $1', [id]);
    if (productoCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    const producto = productoCheck.rows[0];

    // Eliminar producto
    await db.query('DELETE FROM productos WHERE id = $1', [id]);

    res.json({
      message: 'Producto eliminado exitosamente',
      producto_eliminado: {
        id: producto.id,
        nombre: producto.nombre,
        sku: producto.sku
      }
    });

  } catch (error) {
    console.error('Error eliminando producto:', error);
    res.status(500).json({ error: 'Error al eliminar el producto' });
  }
});


// -----------------------------
// Crear una venta con detalles
// -----------------------------
app.post('/ventas', verificarToken, async (req, res) => {
  const client = await db.connect();
  try {
    const { numero_boleta, fecha, vendedor, forma_pago, total, monto_recibido, vuelto, items } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Debe enviar al menos un item en ventas_detalle' });
    }

    await client.query('BEGIN');

    const ventaResult = await client.query(
      `INSERT INTO ventas (numero_boleta, fecha, vendedor, forma_pago, total, monto_recibido, vuelto)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        numero_boleta,
        new Date(fecha).toISOString(),
        vendedor,
        forma_pago,
        Number(total),
        Number(monto_recibido),
        Number(vuelto)
      ]
    );

    const ventaId = ventaResult.rows[0].id;

    for (const item of items) {
      const cantidad = Number(item.cantidad);
      const precio_unitario = Number(item.precio_unitario);

      if (isNaN(cantidad) || isNaN(precio_unitario)) {
        throw new Error(`Cantidad o precio_unitario inválidos en item: ${JSON.stringify(item)}`);
      }

      const subtotal = cantidad * precio_unitario;

      await client.query(
        `INSERT INTO ventas_detalle (venta_id, sku, descripcion, cantidad, precio_unitario)
         VALUES ($1, $2, $3, $4, $5)`,
        [ventaId, item.sku, item.descripcion, cantidad, precio_unitario]
      );
    }

    await client.query('COMMIT');
    res.json({ message: 'Venta registrada correctamente', ventaId });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error al registrar venta:', error);
    res.status(500).json({ error: 'Error al registrar la venta', detalle: error.message, stack: error.stack });
  } finally {
    client.release();
  }
});

// -----------------------------
// Obtener todas las ventas con sus detalles
// -----------------------------
app.get('/ventas', verificarToken, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT v.*, json_agg(
        json_build_object(
          'sku', d.sku,
          'descripcion', d.descripcion,
          'cantidad', d.cantidad,
          'precio_unitario', d.precio_unitario,
          'subtotal', d.subtotal
        )
      ) AS items
      FROM ventas v
      LEFT JOIN ventas_detalle d ON v.id = d.venta_id
      GROUP BY v.id
      ORDER BY v.fecha DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener las ventas' });
  }
});

// -----------------------------
// Historial de ventas con filtros y paginación
// -----------------------------
app.get('/ventas/historial', verificarToken, async (req, res) => {
  try {
    const {
      pagina = 1,
      limite = 20,
      fecha_inicio,
      fecha_fin,
      vendedor,
      forma_pago,
      ordenar_por = 'fecha',
      orden = 'DESC'
    } = req.query;

    // Validar parámetros
    const offset = (parseInt(pagina) - 1) * parseInt(limite);
    const ordenesValidos = ['fecha', 'total', 'vendedor', 'numero_boleta'];
    const direccionesValidas = ['ASC', 'DESC'];

    if (!ordenesValidos.includes(ordenar_por)) {
      return res.status(400).json({ error: 'Campo de ordenamiento inválido' });
    }

    if (!direccionesValidas.includes(orden.toUpperCase())) {
      return res.status(400).json({ error: 'Dirección de ordenamiento inválida' });
    }

    // Construir query base
    let whereConditions = [];
    let queryParams = [];
    let paramCount = 1;

    // Filtros de fecha
    if (fecha_inicio) {
      whereConditions.push(`DATE(v.fecha) >= $${paramCount}`);
      queryParams.push(fecha_inicio);
      paramCount++;
    }

    if (fecha_fin) {
      whereConditions.push(`DATE(v.fecha) <= $${paramCount}`);
      queryParams.push(fecha_fin);
      paramCount++;
    }

    // Filtro de vendedor
    if (vendedor) {
      whereConditions.push(`v.vendedor ILIKE $${paramCount}`);
      queryParams.push(`%${vendedor}%`);
      paramCount++;
    }

    // Filtro de forma de pago
    if (forma_pago) {
      whereConditions.push(`v.forma_pago = $${paramCount}`);
      queryParams.push(forma_pago);
      paramCount++;
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // Query principal con filtros y paginación
    const query = `
      SELECT 
        v.id,
        v.numero_boleta,
        v.fecha,
        v.vendedor,
        v.forma_pago,
        v.total,
        v.monto_recibido,
        v.vuelto,
        json_agg(
          json_build_object(
            'sku', d.sku,
            'descripcion', d.descripcion,
            'cantidad', d.cantidad,
            'precio_unitario', d.precio_unitario,
            'subtotal', d.cantidad * d.precio_unitario
          )
        ) AS items,
        COUNT(d.id) AS total_items
      FROM ventas v
      LEFT JOIN ventas_detalle d ON v.id = d.venta_id
      ${whereClause}
      GROUP BY v.id
      ORDER BY v.${ordenar_por} ${orden}
      LIMIT $${paramCount} OFFSET $${paramCount + 1}
    `;

    // Agregar parámetros de paginación
    queryParams.push(parseInt(limite), offset);

    const result = await db.query(query, queryParams);

    // Query para contar total de registros
    const countQuery = `
      SELECT COUNT(DISTINCT v.id) as total
      FROM ventas v
      ${whereClause}
    `;

    const countResult = await db.query(countQuery, whereConditions.length > 0 ? queryParams.slice(0, -2) : []);
    const totalRegistros = parseInt(countResult.rows[0].total);

    // Query para estadísticas
    const statsQuery = `
      SELECT 
        COUNT(*) as total_ventas,
        SUM(total) as total_ingresos,
        AVG(total) as promedio_venta,
        MIN(total) as venta_minima,
        MAX(total) as venta_maxima,
        COUNT(DISTINCT vendedor) as total_vendedores
      FROM ventas v
      ${whereClause}
    `;

    const statsResult = await db.query(statsQuery, whereConditions.length > 0 ? queryParams.slice(0, -2) : []);
    const estadisticas = statsResult.rows[0];

    // Query para top vendedores
    const topVendedoresQuery = `
      SELECT 
        vendedor,
        COUNT(*) as total_ventas,
        SUM(total) as total_ventas_monto
      FROM ventas v
      ${whereClause}
      GROUP BY vendedor
      ORDER BY total_ventas_monto DESC
      LIMIT 5
    `;

    const topVendedoresResult = await db.query(topVendedoresQuery, whereConditions.length > 0 ? queryParams.slice(0, -2) : []);
    const topVendedores = topVendedoresResult.rows;

    // Query para formas de pago más usadas
    const formasPagoQuery = `
      SELECT 
        forma_pago,
        COUNT(*) as total_ventas,
        SUM(total) as total_monto
      FROM ventas v
      ${whereClause}
      GROUP BY forma_pago
      ORDER BY total_ventas DESC
    `;

    const formasPagoResult = await db.query(formasPagoQuery, whereConditions.length > 0 ? queryParams.slice(0, -2) : []);
    const formasPago = formasPagoResult.rows;

    res.json({
      ventas: result.rows,
      paginacion: {
        pagina: parseInt(pagina),
        limite: parseInt(limite),
        total: totalRegistros,
        totalPaginas: Math.ceil(totalRegistros / parseInt(limite))
      },
      filtros: {
        fecha_inicio,
        fecha_fin,
        vendedor,
        forma_pago,
        ordenar_por,
        orden
      },
      estadisticas: {
        total_ventas: parseInt(estadisticas.total_ventas || 0),
        total_ingresos: parseFloat(estadisticas.total_ingresos || 0),
        promedio_venta: parseFloat(estadisticas.promedio_venta || 0),
        venta_minima: parseFloat(estadisticas.venta_minima || 0),
        venta_maxima: parseFloat(estadisticas.venta_maxima || 0),
        total_vendedores: parseInt(estadisticas.total_vendedores || 0)
      },
      top_vendedores: topVendedores,
      formas_pago: formasPago
    });

  } catch (error) {
    console.error('Error obteniendo historial de ventas:', error);
    res.status(500).json({ error: 'Error al obtener el historial de ventas' });
  }
});

// -----------------------------
// Reporte resumido de ventas por período
// -----------------------------
app.get('/ventas/reporte-resumen/:periodo', verificarToken, async (req, res) => {
  const { periodo } = req.params;
  const { fecha_inicio, fecha_fin } = req.query;

  let filtroFecha;
  let tituloPeriodo;

  if (fecha_inicio && fecha_fin) {
    // Filtro personalizado por fechas
    filtroFecha = "DATE(fecha) BETWEEN $1 AND $2";
    tituloPeriodo = `Del ${fecha_inicio} al ${fecha_fin}`;
  } else {
    // Filtro por período predefinido
    switch (periodo) {
      case 'hoy':
        filtroFecha = "DATE(fecha) = CURRENT_DATE";
        tituloPeriodo = 'Hoy';
        break;
      case 'ayer':
        filtroFecha = "DATE(fecha) = CURRENT_DATE - INTERVAL '1 day'";
        tituloPeriodo = 'Ayer';
        break;
      case 'semana':
        filtroFecha = "DATE_TRUNC('week', fecha) = DATE_TRUNC('week', CURRENT_DATE)";
        tituloPeriodo = 'Esta semana';
        break;
      case 'mes':
        filtroFecha = "DATE_TRUNC('month', fecha) = DATE_TRUNC('month', CURRENT_DATE)";
        tituloPeriodo = 'Este mes';
        break;
      case 'mes_anterior':
        filtroFecha = "DATE_TRUNC('month', fecha) = DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')";
        tituloPeriodo = 'Mes anterior';
        break;
      case 'anio':
        filtroFecha = "DATE_TRUNC('year', fecha) = DATE_TRUNC('year', CURRENT_DATE)";
        tituloPeriodo = 'Este año';
        break;
      default:
        return res.status(400).json({ error: 'Periodo inválido' });
    }
  }

  try {
    const queryParams = fecha_inicio && fecha_fin ? [fecha_inicio, fecha_fin] : [];

    // Estadísticas generales del período
    const statsQuery = `
      SELECT 
        COUNT(*) as total_ventas,
        SUM(total) as total_ingresos,
        AVG(total) as promedio_venta,
        MIN(total) as venta_minima,
        MAX(total) as venta_maxima,
        COUNT(DISTINCT vendedor) as total_vendedores
      FROM ventas
      WHERE ${filtroFecha}
    `;

    const statsResult = await db.query(statsQuery, queryParams);
    const estadisticas = statsResult.rows[0];

    // Top vendedores del período
    const topVendedoresQuery = `
      SELECT 
        vendedor,
        COUNT(*) as total_ventas,
        SUM(total) as total_ventas_monto
      FROM ventas
      WHERE ${filtroFecha}
      GROUP BY vendedor
      ORDER BY total_ventas_monto DESC
      LIMIT 5
    `;

    const topVendedoresResult = await db.query(topVendedoresQuery, queryParams);

    // Ventas por día (últimos 7 días si es período personalizado)
    let ventasPorDiaQuery;
    if (fecha_inicio && fecha_fin) {
      ventasPorDiaQuery = `
        SELECT 
          DATE(fecha) as dia,
          COUNT(*) as total_ventas,
          SUM(total) as total_ingresos
        FROM ventas
        WHERE ${filtroFecha}
        GROUP BY DATE(fecha)
        ORDER BY dia
      `;
    } else {
      ventasPorDiaQuery = `
        SELECT 
          DATE(fecha) as dia,
          COUNT(*) as total_ventas,
          SUM(total) as total_ingresos
        FROM ventas
        WHERE ${filtroFecha}
        GROUP BY DATE(fecha)
        ORDER BY dia
      `;
    }

    const ventasPorDiaResult = await db.query(ventasPorDiaQuery, queryParams);

    // Productos más vendidos del período
    const productosMasVendidosQuery = `
      SELECT 
        d.sku,
        d.descripcion,
        SUM(d.cantidad) as total_vendido,
        SUM(d.cantidad * d.precio_unitario) as total_ingresos
      FROM ventas v
      JOIN ventas_detalle d ON v.id = d.venta_id
      WHERE ${filtroFecha}
      GROUP BY d.sku, d.descripcion
      ORDER BY total_vendido DESC
      LIMIT 10
    `;

    const productosMasVendidosResult = await db.query(productosMasVendidosQuery, queryParams);

    res.json({
      periodo: tituloPeriodo,
      estadisticas: {
        total_ventas: parseInt(estadisticas.total_ventas || 0),
        total_ingresos: parseFloat(estadisticas.total_ingresos || 0),
        promedio_venta: parseFloat(estadisticas.promedio_venta || 0),
        venta_minima: parseFloat(estadisticas.venta_minima || 0),
        venta_maxima: parseFloat(estadisticas.venta_maxima || 0),
        total_vendedores: parseInt(estadisticas.total_vendedores || 0)
      },
      top_vendedores: topVendedoresResult.rows,
      ventas_por_dia: ventasPorDiaResult.rows,
      productos_mas_vendidos: productosMasVendidosResult.rows
    });

  } catch (error) {
    console.error('Error generando reporte resumido:', error);
    res.status(500).json({ error: 'Error al generar el reporte resumido' });
  }
});

// -----------------------------
// Reporte filtrado por periodo
// -----------------------------
app.get('/ventas/reporte/:periodo', verificarToken, async (req, res) => {
  const { periodo } = req.params;

  let filtroFecha;
  switch (periodo) {
    case 'dia':
      filtroFecha = "DATE(fecha) = CURRENT_DATE";
      break;
    case 'semana':
      filtroFecha = "DATE_TRUNC('week', fecha) = DATE_TRUNC('week', CURRENT_DATE)";
      break;
    case 'mes':
      filtroFecha = "DATE_TRUNC('month', fecha) = DATE_TRUNC('month', CURRENT_DATE)";
      break;
    case 'anio':
      filtroFecha = "DATE_TRUNC('year', fecha) = DATE_TRUNC('year', CURRENT_DATE)";
      break;
    default:
      return res.status(400).json({ error: 'Periodo inválido' });
  }

  try {
    const result = await db.query(`
      SELECT v.*, json_agg(
        json_build_object(
          'sku', d.sku,
          'descripcion', d.descripcion,
          'cantidad', d.cantidad,
          'precio_unitario', d.precio_unitario,
          'subtotal', d.subtotal
        )
      ) AS items
      FROM ventas v
      LEFT JOIN ventas_detalle d ON v.id = d.venta_id
      WHERE ${filtroFecha}
      GROUP BY v.id
      ORDER BY v.fecha DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al generar el reporte' });
  }
});

app.post('/ordenes', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const {
      codigo_orden,
      tecnico_id,
      cliente_nombre,
      cliente_telefono,
      cliente_correo,
      marca_id,
      modelo,
      tipo_equipo_id,
      imei_serie,
      patron_contrasena,
      estado_equipo,
      diagnostico,
      observaciones,
      garantia_id,
      costo_reparacion,
      anticipo,
      // Hijos
      verificaciones,
      fallas,
      repuestos,
      fotos
    } = req.body;

    // Insert orden principal
    const insertOrdenText = `
      INSERT INTO ordenes_servicio (
        codigo_orden, tecnico_id, cliente_nombre, cliente_telefono, cliente_correo,
        marca_id, modelo, tipo_equipo_id, imei_serie, patron_contrasena,
        estado_equipo, diagnostico, observaciones, garantia_id, costo_reparacion, anticipo, total
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      RETURNING id`;
    
    const total = (costo_reparacion || 0) - (anticipo || 0);

    const resOrden = await client.query(insertOrdenText, [
      codigo_orden, tecnico_id, cliente_nombre, cliente_telefono, cliente_correo,
      marca_id, modelo, tipo_equipo_id, imei_serie, patron_contrasena,
      estado_equipo, diagnostico, observaciones, garantia_id, costo_reparacion || 0, anticipo || 0, total
    ]);
    const ordenId = resOrden.rows[0].id;

    // Insert verificaciones_equipo si vienen
    if (Array.isArray(verificaciones)) {
      for (const v of verificaciones) {
        await client.query(
          `INSERT INTO verificaciones_equipo 
            (orden_id, enciende, bandeja_sim, golpes, humedad, altavoz, microfono, auricular, otros)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [ordenId, v.enciende || false, v.bandeja_sim || false, v.golpes || false, v.humedad || false,
           v.altavoz || false, v.microfono || false, v.auricular || false, v.otros || false]
        );
      }
    }

    // Insert fallas si vienen
    if (Array.isArray(fallas)) {
      for (const f of fallas) {
        await client.query(
          `INSERT INTO fallas (orden_id, descripcion) VALUES ($1,$2)`,
          [ordenId, f.descripcion]
        );
      }
    }

    // Insert repuestos si vienen
    if (Array.isArray(repuestos)) {
      for (const r of repuestos) {
        await client.query(
          `INSERT INTO orden_repuestos (orden_id, repuesto_id, cantidad, precio_unitario) VALUES ($1,$2,$3,$4)`,
          [ordenId, r.repuesto_id, r.cantidad, r.precio_unitario]
        );
      }
    }

    // Insert fotos si vienen
    if (Array.isArray(fotos)) {
      for (const f of fotos) {
        await client.query(
          `INSERT INTO fotos_orden (orden_id, ruta_foto) VALUES ($1,$2)`,
          [ordenId, f.ruta_foto]
        );
      }
    }

    await client.query('COMMIT');
    res.status(201).json({ message: 'Orden creada', ordenId });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creando orden:', error);
    res.status(500).json({ error: 'Error creando orden' });
  } finally {
    client.release();
  }
});


app.get('/ordenes', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT o.*, u.nombre AS tecnico_nombre, g.nombre AS garantia_nombre, m.nombre AS marca_nombre, te.nombre AS tipo_equipo_nombre
      FROM ordenes_servicio o
      LEFT JOIN usuarios u ON o.tecnico_id = u.id
      LEFT JOIN garantias g ON o.garantia_id = g.id
      LEFT JOIN marcas m ON o.marca_id = m.id
      LEFT JOIN tipos_equipo te ON o.tipo_equipo_id = te.id
      ORDER BY o.fecha_ingreso DESC
      LIMIT 50
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error listando órdenes:', error);
    res.status(500).json({ error: 'Error listando órdenes' });
  }
});

app.get('/ordenes/:id', async (req, res) => {
  const ordenId = req.params.id;
  try {
    const ordenResult = await pool.query(`
      SELECT o.*, u.nombre AS tecnico_nombre, g.nombre AS garantia_nombre, m.nombre AS marca_nombre, te.nombre AS tipo_equipo_nombre
      FROM ordenes_servicio o
      LEFT JOIN usuarios u ON o.tecnico_id = u.id
      LEFT JOIN garantias g ON o.garantia_id = g.id
      LEFT JOIN marcas m ON o.marca_id = m.id
      LEFT JOIN tipos_equipo te ON o.tipo_equipo_id = te.id
      WHERE o.id = $1
    `, [ordenId]);

    if (ordenResult.rows.length === 0) {
      return res.status(404).json({ error: 'Orden no encontrada' });
    }

    const orden = ordenResult.rows[0];

    const [verificacionesRes, fallasRes, repuestosRes, fotosRes] = await Promise.all([
      pool.query('SELECT * FROM verificaciones_equipo WHERE orden_id = $1', [ordenId]),
      pool.query('SELECT * FROM fallas WHERE orden_id = $1', [ordenId]),
      pool.query(`
        SELECT orp.*, p.nombre AS repuesto_nombre 
        FROM orden_repuestos orp
        LEFT JOIN productos p ON orp.repuesto_id = p.id
        WHERE orp.orden_id = $1
      `, [ordenId]),
      pool.query('SELECT * FROM fotos_orden WHERE orden_id = $1', [ordenId])
    ]);

    res.json({
      orden,
      verificaciones: verificacionesRes.rows,
      fallas: fallasRes.rows,
      repuestos: repuestosRes.rows,
      fotos: fotosRes.rows,
    });
  } catch (error) {
    console.error('Error obteniendo detalle de orden:', error);
    res.status(500).json({ error: 'Error obteniendo detalle de orden' });
  }
});

app.patch('/ordenes/:id', async (req, res) => {
  const ordenId = req.params.id;
  const { estado_equipo, diagnostico, observaciones } = req.body;
  try {
    const result = await pool.query(`
      UPDATE ordenes_servicio
      SET estado_equipo = COALESCE($1, estado_equipo),
          diagnostico = COALESCE($2, diagnostico),
          observaciones = COALESCE($3, observaciones)
      WHERE id = $4
      RETURNING *
    `, [estado_equipo, diagnostico, observaciones, ordenId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Orden no encontrada' });
    }

    res.json({ message: 'Orden actualizada', orden: result.rows[0] });
  } catch (error) {
    console.error('Error actualizando orden:', error);
    res.status(500).json({ error: 'Error actualizando orden' });
  }
});

app.get('/usuarios', verificarToken, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, nombre, email, rol FROM usuarios'
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener usuarios:', error);
    res.status(500).json({ error: 'Error al obtener usuarios' });
  }
});

app.post('/usuarios', verificarToken, async (req, res) => {
  const { nombre, email, password, rol } = req.body;

  try {
    // hash password
    const bcrypt = require('bcrypt');
    const saltRounds = 10;
    const password_hash = await bcrypt.hash(password, saltRounds);

    const result = await db.query(
      `INSERT INTO usuarios (nombre, email, password_hash, rol, creado_en, actualizado_en) 
       VALUES ($1, $2, $3, $4, NOW(), NOW()) RETURNING id, nombre, email, rol`,
      [nombre, email, password_hash, rol]
    );

    res.json({ message: 'Usuario creado exitosamente', usuario: result.rows[0] });
  } catch (error) {
    console.error('Error al crear usuario:', error);
    res.status(500).json({ error: 'Error al crear usuario' });
  }
});

app.put('/usuarios/:id', verificarToken, async (req, res) => {
  const { id } = req.params;
  const { rol } = req.body;

  try {
    const result = await db.query(
      `UPDATE usuarios SET rol = $1, actualizado_en = NOW() WHERE id = $2 RETURNING id, nombre, email, rol`,
      [rol, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    res.json({ message: 'Rol actualizado correctamente', usuario: result.rows[0] });
  } catch (error) {
    console.error('Error al actualizar rol:', error);
    res.status(500).json({ error: 'Error al actualizar rol' });
  }
});

app.delete('/usuarios/:id', verificarToken, async (req, res) => {
  const id = parseInt(req.params.id, 10);

  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  try {
    // Usar db.query en vez de pool.query
    const result = await db.query('DELETE FROM usuarios WHERE id = $1 RETURNING id', [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    res.json({ message: 'Usuario eliminado correctamente', id: result.rows[0].id });
  } catch (error) {
    console.error('Error al eliminar usuario:', error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint para cambiar contraseña de usuario
app.put('/usuarios/:id/password', verificarToken, async (req, res) => {
  const { id } = req.params;
  const { nueva_password, confirmar_password, email } = req.body;

  try {
    // Validar que se envíen todos los campos requeridos
    if (!nueva_password || !confirmar_password || !email) {
      return res.status(400).json({ 
        error: 'Se requieren los campos nueva_password, confirmar_password y email' 
      });
    }

    // Validar que las contraseñas coincidan
    if (nueva_password !== confirmar_password) {
      return res.status(400).json({ 
        error: 'Las contraseñas no coinciden' 
      });
    }

    // Validar longitud mínima de contraseña
    if (nueva_password.length < 6) {
      return res.status(400).json({ 
        error: 'La contraseña debe tener al menos 6 caracteres' 
      });
    }

    // Verificar que el usuario existe y que el email coincida
    const usuarioCheck = await db.query('SELECT id, nombre, email FROM usuarios WHERE id = $1 AND email = $2', [id, email]);
    if (usuarioCheck.rows.length === 0) {
      return res.status(404).json({ 
        error: 'Usuario no encontrado o email no coincide con el ID proporcionado' 
      });
    }

    // Encriptar la nueva contraseña
    const saltRounds = 10;
    const nueva_password_hash = await bcrypt.hash(nueva_password, saltRounds);

    // Actualizar la contraseña en la base de datos
    const result = await db.query(
      `UPDATE usuarios 
       SET password_hash = $1, actualizado_en = NOW() 
       WHERE id = $2 AND email = $3
       RETURNING id, nombre, email, rol`,
      [nueva_password_hash, id, email]
    );

    res.json({ 
      message: 'Contraseña actualizada exitosamente',
      usuario: {
        id: result.rows[0].id,
        nombre: result.rows[0].nombre,
        email: result.rows[0].email,
        rol: result.rows[0].rol
      }
    });

  } catch (error) {
    console.error('Error al cambiar contraseña:', error);
    res.status(500).json({ 
      error: 'Error al cambiar la contraseña',
      detalle: error.message 
    });
  }
});

// Endpoint de prueba sin autenticación
app.get('/test-no-auth', async (req, res) => {
  res.json({ message: 'Este endpoint no requiere autenticación', timestamp: new Date().toISOString() });
});

// Endpoint para resetear contraseña (solo para administradores)
app.put('/usuarios/:id/reset-password', verificarToken, async (req, res) => {
  const { id } = req.params;
  const { nueva_password } = req.body;

  try {
    // Verificar que el usuario que hace la petición sea administrador
    if (req.user.rol !== 'admin') {
      return res.status(403).json({ 
        error: 'Solo los administradores pueden resetear contraseñas' 
      });
    }

    // Validar que se envíe la nueva contraseña
    if (!nueva_password) {
      return res.status(400).json({ 
        error: 'Se requiere el campo nueva_password' 
      });
    }

    // Validar longitud mínima de contraseña
    if (nueva_password.length < 6) {
      return res.status(400).json({ 
        error: 'La contraseña debe tener al menos 6 caracteres' 
      });
    }

    // Verificar que el usuario existe
    const usuarioCheck = await db.query('SELECT id, nombre, email FROM usuarios WHERE id = $1', [id]);
    if (usuarioCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    // Encriptar la nueva contraseña
    const saltRounds = 10;
    const nueva_password_hash = await bcrypt.hash(nueva_password, saltRounds);

    // Actualizar la contraseña en la base de datos
    const result = await db.query(
      `UPDATE usuarios 
       SET password_hash = $1, actualizado_en = NOW() 
       WHERE id = $2 
       RETURNING id, nombre, email, rol`,
      [nueva_password_hash, id]
    );

    res.json({ 
      message: 'Contraseña reseteada exitosamente por administrador',
      usuario: {
        id: result.rows[0].id,
        nombre: result.rows[0].nombre,
        email: result.rows[0].email,
        rol: result.rows[0].rol
      },
      reseteado_por: {
        id: req.user.id,
        nombre: req.user.nombre,
        email: req.user.email
      }
    });

  } catch (error) {
    console.error('Error al resetear contraseña:', error);
    res.status(500).json({ 
      error: 'Error al resetear la contraseña',
      detalle: error.message 
    });
  }
});

// =================== TIPOS DE EQUIPO ===================
app.get('/tipos-equipo', verificarToken, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM tipos_equipo ORDER BY nombre');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener los tipos de equipo' });
  }
});

app.post('/tipos-equipo', verificarToken, async (req, res) => {
  const { nombre } = req.body;
  try {
    const result = await db.query(
      'INSERT INTO tipos_equipo (nombre) VALUES ($1) RETURNING *',
      [nombre]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear el tipo de equipo' });
  }
});

// =================== ÓRDENES DE SERVICIO ===================
app.get('/ordenes-servicio', verificarToken, async (req, res) => {
  try {
    const { pagina = 1, limite = 20 } = req.query;
    const offset = (parseInt(pagina) - 1) * parseInt(limite);
    
    // Query principal con paginación
    const result = await db.query(`
      SELECT 
          os.id AS id_orden,
          os.codigo_orden,
          os.fecha_ingreso,
          os.cliente_nombre AS cliente,
          os.cliente_telefono,
          os.cliente_correo,
          COALESCE(te.nombre, 'Sin tipo') AS tipo_equipo,
          COALESCE(m.marca, 'Sin marca') AS marca,
          os.modelo,
          os.estado_equipo AS estado,
          os.imei_serie,
          os.diagnostico,
          os.total,
          os.anticipo,
          os.costo_reparacion
      FROM ordenes_servicio os
      LEFT JOIN tipos_equipo te ON te.id = os.tipo_equipo_id
      LEFT JOIN marcas m ON m.id = os.marca_id
      ORDER BY os.fecha_ingreso DESC
      LIMIT $1 OFFSET $2
    `, [parseInt(limite), offset]);

    // Obtener el estado de reparación de las fallas para cada orden
    const ordenesConEstado = await Promise.all(
      result.rows.map(async (orden) => {
        try {
          const fallasResult = await db.query(`
            SELECT estado FROM fallas 
            WHERE orden_id = $1 
            ORDER BY id DESC 
            LIMIT 1
          `, [orden.id_orden]);
          
          return {
            ...orden,
            estado_reparacion: fallasResult.rows.length > 0 ? fallasResult.rows[0].estado : 'PENDIENTE'
          };
        } catch (error) {
          console.error(`Error obteniendo estado para orden ${orden.id_orden}:`, error);
          return {
            ...orden,
            estado_reparacion: 'PENDIENTE'
          };
        }
      })
    );

    // Query para contar total de registros
    const countResult = await db.query('SELECT COUNT(*) as total FROM ordenes_servicio');
    const totalRegistros = parseInt(countResult.rows[0].total);

    res.json({
      ordenes: ordenesConEstado,
      paginacion: {
        pagina: parseInt(pagina),
        limite: parseInt(limite),
        total: totalRegistros,
        totalPaginas: Math.ceil(totalRegistros / parseInt(limite))
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener órdenes de servicio' });
  }
});

app.post('/ordenes-servicio', verificarToken, async (req, res) => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    let {
      codigo_orden,
      tecnico_id,
      cliente_nombre,
      cliente_telefono,
      cliente_correo,
      marca_id,
      marca, // Agregar soporte para nombre de marca
      modelo,
      tipo_equipo_id,
      tipo_equipo, // Agregar soporte para nombre de tipo
      imei_serie,
      patron_contrasena,
      estado_equipo,
      diagnostico,
      observaciones,
      garantia_id,
      costo_reparacion,
      anticipo,
      // Hijos
      verificaciones,
      fallas,
      repuestos,
      fotos
    } = req.body;

    // Si se envía nombre de marca en lugar de ID, buscar el ID
    if (marca && !marca_id) {
      const marcaResult = await client.query('SELECT id FROM marcas WHERE marca = $1', [marca]);
      if (marcaResult.rows.length > 0) {
        marca_id = marcaResult.rows[0].id;
      } else {
        // Si no existe la marca, crearla
        const nuevaMarca = await client.query('INSERT INTO marcas (marca) VALUES ($1) RETURNING id', [marca]);
        marca_id = nuevaMarca.rows[0].id;
      }
    }

    // Si se envía nombre de tipo en lugar de ID, buscar el ID
    if (tipo_equipo && !tipo_equipo_id) {
      const tipoResult = await client.query('SELECT id FROM tipos_equipo WHERE nombre = $1', [tipo_equipo]);
      if (tipoResult.rows.length > 0) {
        tipo_equipo_id = tipoResult.rows[0].id;
      } else {
        // Si no existe el tipo, crearlo
        const nuevoTipo = await client.query('INSERT INTO tipos_equipo (nombre) VALUES ($1) RETURNING id', [tipo_equipo]);
        tipo_equipo_id = nuevoTipo.rows[0].id;
      }
    }

    // Insert orden principal
    const insertOrdenText = `
      INSERT INTO ordenes_servicio (
        codigo_orden, tecnico_id, cliente_nombre, cliente_telefono, cliente_correo,
        marca_id, modelo, tipo_equipo_id, imei_serie, patron_contrasena,
        estado_equipo, diagnostico, observaciones, garantia_id, costo_reparacion, anticipo, total
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      RETURNING id`;
    
    const total = (costo_reparacion || 0) - (anticipo || 0);

    const resOrden = await client.query(insertOrdenText, [
      codigo_orden, tecnico_id, cliente_nombre, cliente_telefono, cliente_correo,
      marca_id, modelo, tipo_equipo_id, imei_serie, patron_contrasena,
      estado_equipo, diagnostico, observaciones, garantia_id, costo_reparacion || 0, anticipo || 0, total
    ]);
    const ordenId = resOrden.rows[0].id;

    // Insert verificaciones_equipo si vienen
    if (Array.isArray(verificaciones)) {
      for (const v of verificaciones) {
        await client.query(
          `INSERT INTO verificaciones_equipo 
            (orden_id, enciende, bandeja_sim, golpes, humedad, altavoz, microfono, auricular, otros)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [ordenId, v.enciende || false, v.bandeja_sim || false, v.golpes || false, v.humedad || false,
           v.altavoz || false, v.microfono || false, v.auricular || false, v.otros || false]
        );
      }
    }

    // Insert fallas si vienen
    if (Array.isArray(fallas)) {
      for (const v of fallas) {
        await client.query(
          `INSERT INTO fallas (orden_id, descripcion) VALUES ($1,$2)`,
          [ordenId, v.descripcion]
        );
      }
    }

    // Insert repuestos si vienen
    if (Array.isArray(repuestos)) {
      for (const r of repuestos) {
        await client.query(
          `INSERT INTO orden_repuestos (orden_id, repuesto_id, cantidad, precio_unitario) VALUES ($1,$2,$3,$4)`,
          [ordenId, r.repuesto_id, r.cantidad, r.precio_unitario]
        );
      }
    }

    // Insert fotos si vienen
    if (Array.isArray(fotos)) {
      for (const f of fotos) {
        await client.query(
          `INSERT INTO fotos_orden (orden_id, ruta_foto) VALUES ($1,$2)`,
          [ordenId, f.ruta_foto]
        );
      }
    }

    await client.query('COMMIT');
    res.status(201).json({ message: 'Orden de servicio creada exitosamente', ordenId });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creando orden de servicio:', error);
    res.status(500).json({ error: 'Error al crear la orden de servicio' });
  } finally {
    client.release();
  }
});

// Endpoint para obtener una orden específica por ID
app.get('/ordenes-servicio/:id', verificarToken, async (req, res) => {
  const { id } = req.params;
  
  try {
    // Obtener la orden principal
    const ordenResult = await db.query(`
      SELECT 
          os.*,
          te.nombre AS tipo_equipo_nombre,
          m.marca AS marca_nombre,
          u.nombre AS tecnico_nombre
      FROM ordenes_servicio os
      LEFT JOIN tipos_equipo te ON te.id = os.tipo_equipo_id
      LEFT JOIN marcas m ON m.id = os.marca_id
      LEFT JOIN usuarios u ON u.id = os.tecnico_id
      WHERE os.id = $1
    `, [id]);

    if (ordenResult.rows.length === 0) {
      return res.status(404).json({ error: 'Orden de servicio no encontrada' });
    }

    const orden = ordenResult.rows[0];

    // Obtener verificaciones del equipo
    const verificacionesResult = await db.query(`
      SELECT * FROM verificaciones_equipo WHERE orden_id = $1
    `, [id]);

    // Obtener fallas reportadas
    const fallasResult = await db.query(`
      SELECT * FROM fallas WHERE orden_id = $1 ORDER BY id
    `, [id]);

    // Obtener repuestos utilizados
    const repuestosResult = await db.query(`
      SELECT orp.*, p.nombre AS repuesto_nombre, p.sku
      FROM orden_repuestos orp
      LEFT JOIN productos p ON orp.repuesto_id = p.id
      WHERE orp.orden_id = $1
    `, [id]);

    // Obtener fotos de la orden
    const fotosResult = await db.query(`
      SELECT * FROM fotos_orden WHERE orden_id = $1
    `, [id]);

    // Calcular estado_reparacion desde las fallas (igual que en el endpoint de listar)
    let estadoReparacion = 'PENDIENTE';
    if (fallasResult.rows.length > 0) {
      // Buscar la primera falla con estado definido
      const fallaConEstado = fallasResult.rows.find(f => f.estado && f.estado !== 'PENDIENTE');
      if (fallaConEstado) {
        estadoReparacion = fallaConEstado.estado;
      } else {
        estadoReparacion = fallasResult.rows[0].estado || 'PENDIENTE';
      }
    }

    res.json({
      orden: {
        ...orden,
        tipo_equipo: orden.tipo_equipo_nombre,
        marca: orden.marca_nombre,
        tecnico: orden.tecnico_nombre,
        estado_reparacion: estadoReparacion
      },
      verificaciones: verificacionesResult.rows,
      fallas: fallasResult.rows,
      repuestos: repuestosResult.rows,
      fotos: fotosResult.rows
    });

  } catch (error) {
    console.error('Error obteniendo orden:', error);
    res.status(500).json({ error: 'Error al obtener la orden de servicio' });
  }
});

// Endpoint para actualizar una orden existente
app.put('/ordenes-servicio/:id', verificarToken, async (req, res) => {
  const { id } = req.params;
  const client = await db.connect();
  
  try {
    await client.query('BEGIN');

    const {
      codigo_orden,
      tecnico_id,
      cliente_nombre,
      cliente_telefono,
      cliente_correo,
      marca_id,
      marca,
      modelo,
      tipo_equipo_id,
      tipo_equipo,
      imei_serie,
      patron_contrasena,
      estado_equipo,
      diagnostico,
      observaciones,
      garantia_id,
      costo_reparacion,
      anticipo,
      // Hijos
      verificaciones,
      fallas,
      repuestos,
      fotos
    } = req.body;

    // Manejar marca y tipo_equipo como en el POST
    let finalMarcaId = marca_id;
    let finalTipoEquipoId = tipo_equipo_id;

    if (marca && !marca_id) {
      const marcaResult = await client.query('SELECT id FROM marcas WHERE marca = $1', [marca]);
      if (marcaResult.rows.length > 0) {
        finalMarcaId = marcaResult.rows[0].id;
      } else {
        const nuevaMarca = await client.query('INSERT INTO marcas (marca) VALUES ($1) RETURNING id', [marca]);
        finalMarcaId = nuevaMarca.rows[0].id;
      }
    }

    if (tipo_equipo && !tipo_equipo_id) {
      const tipoResult = await client.query('SELECT id FROM tipos_equipo WHERE nombre = $1', [tipo_equipo]);
      if (tipoResult.rows.length > 0) {
        finalTipoEquipoId = tipoResult.rows[0].id;
      } else {
        const nuevoTipo = await client.query('INSERT INTO tipos_equipo (nombre) VALUES ($1) RETURNING id', [tipo_equipo]);
        finalTipoEquipoId = nuevoTipo.rows[0].id;
      }
    }

    // Calcular total como en el POST
    const total = (costo_reparacion || 0) - (anticipo || 0);

    // Actualizar orden principal usando la misma estructura que el POST
    const updateOrdenText = `
      UPDATE ordenes_servicio SET
        codigo_orden = COALESCE($1, codigo_orden),
        tecnico_id = COALESCE($2, tecnico_id),
        cliente_nombre = COALESCE($3, cliente_nombre),
        cliente_telefono = COALESCE($4, cliente_telefono),
        cliente_correo = COALESCE($5, cliente_correo),
        marca_id = COALESCE($6, marca_id),
        modelo = COALESCE($7, modelo),
        tipo_equipo_id = COALESCE($8, tipo_equipo_id),
        imei_serie = COALESCE($9, imei_serie),
        patron_contrasena = COALESCE($10, patron_contrasena),
        estado_equipo = COALESCE($11, estado_equipo),
        diagnostico = COALESCE($12, diagnostico),
        observaciones = COALESCE($13, observaciones),
        garantia_id = COALESCE($14, garantia_id),
        costo_reparacion = COALESCE($15, costo_reparacion),
        anticipo = COALESCE($16, anticipo),
        total = $17
      WHERE id = $18
      RETURNING *
    `;

    const result = await client.query(updateOrdenText, [
      codigo_orden, tecnico_id, cliente_nombre, cliente_telefono, cliente_correo,
      finalMarcaId, modelo, finalTipoEquipoId, imei_serie, patron_contrasena,
      estado_equipo, diagnostico, observaciones, garantia_id, costo_reparacion || 0, anticipo || 0, total, id
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Orden de servicio no encontrada' });
    }

    // Actualizar verificaciones usando la misma lógica que el POST
    if (Array.isArray(verificaciones)) {
      // Eliminar verificaciones existentes
      await client.query('DELETE FROM verificaciones_equipo WHERE orden_id = $1', [id]);
      
      // Insertar nuevas verificaciones como en el POST
      for (const v of verificaciones) {
        await client.query(
          `INSERT INTO verificaciones_equipo 
            (orden_id, enciende, bandeja_sim, golpes, humedad, altavoz, microfono, auricular, otros)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [id, v.enciende || false, v.bandeja_sim || false, v.golpes || false, v.humedad || false,
           v.altavoz || false, v.microfono || false, v.auricular || false, v.otros || false]
        );
      }
    }

    // Actualizar fallas usando la misma lógica que el POST
    if (Array.isArray(fallas)) {
      // Eliminar fallas existentes
      await client.query('DELETE FROM fallas WHERE orden_id = $1', [id]);
      
      // Insertar nuevas fallas como en el POST (solo orden_id y descripcion)
      for (const f of fallas) {
        await client.query(
          `INSERT INTO fallas (orden_id, descripcion) VALUES ($1,$2)`,
          [id, f.descripcion]
        );
      }
    }



    // Actualizar repuestos usando la misma lógica que el POST
    if (Array.isArray(repuestos)) {
      // Eliminar repuestos existentes
      await client.query('DELETE FROM orden_repuestos WHERE orden_id = $1', [id]);
      
      // Insertar nuevos repuestos como en el POST
      for (const r of repuestos) {
        await client.query(
          `INSERT INTO orden_repuestos (orden_id, repuesto_id, cantidad, precio_unitario) VALUES ($1,$2,$3,$4)`,
          [id, r.repuesto_id, r.cantidad, r.precio_unitario]
        );
      }
    }

    // Actualizar fotos usando la misma lógica que el POST
    if (Array.isArray(fotos)) {
      // Eliminar fotos existentes
      await client.query('DELETE FROM fotos_orden WHERE orden_id = $1', [id]);
      
      // Insertar nuevas fotos como en el POST
      for (const f of fotos) {
        await client.query(
          `INSERT INTO fotos_orden (orden_id, ruta_foto) VALUES ($1,$2)`,
          [id, f.ruta_foto]
        );
      }
    }

    await client.query('COMMIT');
    
    res.json({ 
      message: 'Orden de servicio actualizada exitosamente',
      orden: result.rows[0]
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error actualizando orden:', error);
    res.status(500).json({ 
      error: 'Error al actualizar la orden de servicio',
      detalle: error.message
    });
  } finally {
    client.release();
  }
});

// Endpoint para actualizar solo el estado de reparación
app.patch('/ordenes-servicio/:id/estado-reparacion', verificarToken, async (req, res) => {
  const { id } = req.params;
  const { estado_reparacion } = req.body;
  
  if (!estado_reparacion) {
    return res.status(400).json({ error: 'El campo estado_reparacion es requerido' });
  }

  const client = await db.connect();
  
  try {
    await client.query('BEGIN');

    // Verificar si la orden existe
    const ordenResult = await client.query('SELECT id FROM ordenes_servicio WHERE id = $1', [id]);
    if (ordenResult.rows.length === 0) {
      return res.status(404).json({ error: 'Orden no encontrada' });
    }

    // Verificar si existen fallas para esta orden
    const fallasExistentes = await client.query('SELECT COUNT(*) FROM fallas WHERE orden_id = $1', [id]);
    
    if (parseInt(fallasExistentes.rows[0].count) === 0) {
      // Si no hay fallas, crear una falla por defecto con el estado
      await client.query(
        `INSERT INTO fallas (orden_id, descripcion, estado) VALUES ($1, $2, $3)`,
        [id, 'Falla general', estado_reparacion]
      );
    } else {
      // Si ya existen fallas, actualizar el estado de todas las fallas de esta orden
      await client.query(
        `UPDATE fallas SET estado = $1 WHERE orden_id = $2`,
        [estado_reparacion, id]
      );
    }

    await client.query('COMMIT');
    
    res.json({ 
      message: 'Estado de reparación actualizado correctamente',
      orden_id: id,
      estado_reparacion: estado_reparacion
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error procesando estado de reparación:', error);
    
    res.status(500).json({ 
      error: 'Error al procesar el estado de reparación',
      detalle: error.message
    });
  } finally {
    client.release();
  }
});

// Endpoint para actualizar tipo y marca de una orden existente
app.patch('/ordenes-servicio/:id/tipo-marca', verificarToken, async (req, res) => {
  const { id } = req.params;
  const { tipo_equipo_id, marca_id } = req.body;
  
  try {
    const result = await db.query(`
      UPDATE ordenes_servicio 
      SET tipo_equipo_id = $1, marca_id = $2
      WHERE id = $3 
      RETURNING *
    `, [tipo_equipo_id, marca_id, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Orden no encontrada' });
    }

    res.json({ 
      message: 'Tipo y marca actualizados correctamente', 
      orden: result.rows[0] 
    });
  } catch (error) {
    console.error('Error actualizando tipo y marca:', error);
    res.status(500).json({ error: 'Error al actualizar tipo y marca' });
  }
});

// Endpoint para eliminar una orden de servicio
app.delete('/ordenes-servicio/:id', verificarToken, async (req, res) => {
  const { id } = req.params;
  const client = await db.connect();
  
  try {
    await client.query('BEGIN');

    // Verificar que la orden existe
    const ordenCheck = await client.query(
      'SELECT id, codigo_orden FROM ordenes_servicio WHERE id = $1',
      [id]
    );

    if (ordenCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Orden de servicio no encontrada' });
    }

    const orden = ordenCheck.rows[0];

    // Eliminar registros relacionados en orden específico
    await client.query('DELETE FROM verificaciones_equipo WHERE orden_id = $1', [id]);
    await client.query('DELETE FROM fallas WHERE orden_id = $1', [id]);
    await client.query('DELETE FROM orden_repuestos WHERE orden_id = $1', [id]);
    await client.query('DELETE FROM fotos_orden WHERE orden_id = $1', [id]);
    
    // Finalmente eliminar la orden principal
    await client.query('DELETE FROM ordenes_servicio WHERE id = $1', [id]);

    await client.query('COMMIT');
    
    res.json({ 
      message: 'Orden de servicio eliminada exitosamente',
      ordenEliminada: {
        id: orden.id,
        codigo_orden: orden.codigo_orden
      }
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error eliminando orden de servicio:', error);
    res.status(500).json({ error: 'Error al eliminar la orden de servicio' });
  } finally {
    client.release();
  }
});


// =================== SERVER ===================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});
