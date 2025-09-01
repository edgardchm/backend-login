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
    await db.query('DELETE FROM tipos_repuestos WHERE id = $1', [id]);
    res.json({ message: 'Repuesto eliminado' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar el repuesto' });
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

app.post('/repuestos-marca', verificarToken, async (req, res) => {
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
});

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

// =================== GESTIÓN COMPLETA DE PRODUCTOS ===================

// Obtener todos los productos con paginación y filtros
app.get('/productos', verificarToken, async (req, res) => {
  try {
    const {
      pagina = 1,
      limite = 20,
      por_pagina, // Agregar soporte para por_pagina
      busqueda,
      marca_id,
      tipo_id,
      ordenar_por = 'nombre',
      orden = 'ASC',
      stock_minimo
    } = req.query;

    // Usar por_pagina si está disponible, sino usar limite
    const limiteFinal = por_pagina ? parseInt(por_pagina) : parseInt(limite);

    // Validar parámetros
    const offset = (parseInt(pagina) - 1) * limiteFinal;
    const ordenesValidos = ['nombre', 'sku', 'precio', 'stock', 'marca', 'tipo', 'fecha_creacion'];
    const direccionesValidas = ['ASC', 'DESC'];

    if (!ordenesValidos.includes(ordenar_por)) {
      return res.status(400).json({ 
        error: 'Campo de ordenamiento inválido',
        campos_validos: ordenesValidos,
        campo_enviado: ordenar_por
      });
    }

    if (!direccionesValidas.includes(orden.toUpperCase())) {
      return res.status(400).json({ 
        error: 'Dirección de ordenamiento inválida',
        direcciones_validas: direccionesValidas,
        direccion_enviada: orden
      });
    }

    // Construir query base
    let whereConditions = [];
    let queryParams = [];
    let paramCount = 1;

    // Filtro de búsqueda
    if (busqueda) {
      whereConditions.push(`(p.nombre ILIKE $${paramCount} OR p.sku ILIKE $${paramCount} OR p.sku = $${paramCount + 1})`);
      queryParams.push(`%${busqueda}%`, busqueda);
      paramCount += 2;
    }

    // Filtro por marca
    if (marca_id) {
      whereConditions.push(`p.marca_id = $${paramCount}`);
      queryParams.push(marca_id);
      paramCount++;
    }

    // Filtro por tipo
    if (tipo_id) {
      whereConditions.push(`p.tipo_id = $${paramCount}`);
      queryParams.push(tipo_id);
      paramCount++;
    }

    // Filtro por stock mínimo
    if (stock_minimo) {
      whereConditions.push(`p.stock <= $${paramCount}`);
      queryParams.push(parseInt(stock_minimo));
      paramCount++;
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // Query principal con filtros y paginación
    const query = `
      SELECT 
        p.id,
        p.nombre,
        p.sku,
        p.precio,
        p.precio_mayor,
        p.precio_cliente,
        p.stock,
        p.fecha_creacion,
        p.fecha_actualizacion,
        m.marca AS marca_nombre,
        m.id AS marca_id,
        t.nombre AS tipo_nombre,
        t.id AS tipo_id
      FROM productos p
      LEFT JOIN marcas m ON p.marca_id = m.id
      LEFT JOIN tipos_producto t ON p.tipo_id = t.id
      ${whereClause}
      ORDER BY 
        ${busqueda ? `CASE WHEN p.sku = '${busqueda}' THEN 1 WHEN p.sku LIKE '%${busqueda}%' THEN 2 ELSE 3 END,` : ''}
        p.${ordenar_por} ${orden}
      LIMIT $${paramCount} OFFSET $${paramCount + 1}
    `;

    // Agregar parámetros de paginación
    queryParams.push(limiteFinal, offset);

    const result = await db.query(query, queryParams);

    // Query para contar total de registros
    const countQuery = `
      SELECT COUNT(*) as total
      FROM productos p
      ${whereClause}
    `;

    const countResult = await db.query(countQuery, whereConditions.length > 0 ? queryParams.slice(0, -2) : []);
    const totalRegistros = parseInt(countResult.rows[0].total);

    // Query para estadísticas
    const statsQuery = `
      SELECT 
        COUNT(*) as total_productos,
        COALESCE(SUM(stock), 0) as stock_total,
        COALESCE(AVG(precio), 0) as precio_promedio,
        COALESCE(MIN(precio), 0) as precio_minimo,
        COALESCE(MAX(precio), 0) as precio_maximo,
        COUNT(DISTINCT marca_id) as total_marcas,
        COUNT(DISTINCT tipo_id) as total_tipos
      FROM productos p
      ${whereClause}
    `;

    const statsResult = await db.query(statsQuery, whereConditions.length > 0 ? queryParams.slice(0, -2) : []);
    const estadisticas = statsResult.rows[0];

    // Query para productos con stock bajo
    const stockBajoQuery = `
      SELECT COUNT(*) as productos_stock_bajo
      FROM productos
      WHERE stock <= 10
    `;
    const stockBajoResult = await db.query(stockBajoQuery);
    const stockBajo = parseInt(stockBajoResult.rows[0].productos_stock_bajo);

    res.json({
      productos: result.rows,
      paginacion: {
        pagina: parseInt(pagina),
        limite: limiteFinal,
        total: totalRegistros,
        totalPaginas: Math.ceil(totalRegistros / limiteFinal)
      },
      filtros: {
        busqueda,
        marca_id,
        tipo_id,
        stock_minimo,
        ordenar_por,
        orden
      },
      estadisticas: {
        total_productos: parseInt(estadisticas.total_productos || 0),
        stock_total: parseInt(estadisticas.stock_total || 0),
        precio_promedio: parseFloat(estadisticas.precio_promedio || 0),
        precio_minimo: parseFloat(estadisticas.precio_minimo || 0),
        precio_maximo: parseFloat(estadisticas.precio_maximo || 0),
        total_marcas: parseInt(estadisticas.total_marcas || 0),
        total_tipos: parseInt(estadisticas.total_tipos || 0),
        productos_stock_bajo: stockBajo
      }
    });

  } catch (error) {
    console.error('Error obteniendo productos:', error);
    res.status(500).json({ 
      error: 'Error al obtener los productos',
      detalle: error.message,
      stack: error.stack
    });
  }
});

// Obtener un producto específico por ID o buscar por nombre/SKU
app.get('/productos/:parametro', verificarToken, async (req, res) => {
  try {
    const { parametro } = req.params;
    
    console.log('Parámetro recibido:', parametro);
    
    // Verificar si el parámetro es un ID numérico
    const esId = !isNaN(parametro) && parseInt(parametro) > 0;
    
    console.log('¿Es ID?', esId);
    
    if (esId) {
      // Es un ID, obtener producto específico
      console.log('Buscando por ID:', parametro);
      
      const query = `
        SELECT 
          p.id,
          p.nombre,
          p.sku,
          p.precio,
          p.precio_mayor,
          p.precio_cliente,
          p.stock,
          p.fecha_creacion,
          p.fecha_actualizacion,
          m.marca AS marca_nombre,
          m.id AS marca_id,
          t.nombre AS tipo_nombre,
          t.id AS tipo_id
        FROM productos p
        LEFT JOIN marcas m ON p.marca_id = m.id
        LEFT JOIN tipos_producto t ON p.tipo_id = t.id
        WHERE p.id = $1
      `;

      const result = await db.query(query, [parseInt(parametro)]);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Producto no encontrado' });
      }

      res.json(result.rows[0]);
    } else {
      // Es una búsqueda, buscar por nombre o SKU
      console.log('Buscando por texto:', parametro);
      
      const query = `
        SELECT 
          p.id,
          p.nombre,
          p.sku,
          p.precio,
          p.precio_mayor,
          p.precio_cliente,
          p.stock,
          p.fecha_creacion,
          p.fecha_actualizacion,
          m.marca AS marca, 
          t.nombre AS tipo
        FROM productos p
        LEFT JOIN marcas m ON p.marca_id = m.id
        LEFT JOIN tipos_producto t ON p.tipo_id = t.id
        WHERE p.sku ILIKE $1
           OR p.nombre ILIKE $1
        ORDER BY 
          CASE 
            WHEN p.sku = $2 THEN 1
            WHEN p.sku ILIKE $3 THEN 2
            ELSE 3
          END,
          p.nombre
      `;

      const searchPattern = `%${parametro}%`;
      const skuExacto = parametro;
      const skuPattern = `%${parametro}%`;
      
      console.log('Parámetros de búsqueda:', { searchPattern, skuExacto, skuPattern });
      
      const result = await db.query(query, [searchPattern, skuExacto, skuPattern]);

      if (result.rows.length === 0) {
        return res.status(404).json({ message: 'No se encontraron productos con esa búsqueda' });
      }

      // Si solo hay un resultado exacto por SKU, devolver solo ese
      if (result.rows.length === 1 && result.rows[0].sku.toLowerCase() === parametro.toLowerCase()) {
        return res.json(result.rows[0]);
      }

      // Si hay múltiples resultados, devolver el array
      res.json({
        total: result.rows.length,
        productos: result.rows,
        busqueda: parametro
      });
    }

  } catch (error) {
    console.error('Error completo:', error);
    console.error('Stack trace:', error.stack);
    console.error('Mensaje:', error.message);
    res.status(500).json({ 
      error: 'Error al obtener/buscar el producto',
      detalle: error.message,
      stack: error.stack,
      parametro: req.params.parametro
    });
  }
});

// Crear un nuevo producto
app.post('/productos', verificarToken, async (req, res) => {
  try {
    const {
      nombre,
      sku,
      precio,
      precio_mayor,
      precio_cliente,
      stock,
      marca_id,
      tipo_id
    } = req.body;

    // Validaciones básicas
    if (!nombre || !sku) {
      return res.status(400).json({ error: 'Nombre y SKU son obligatorios' });
    }

    // Verificar si el SKU ya existe
    const skuCheck = await db.query('SELECT id FROM productos WHERE sku = $1', [sku]);
    if (skuCheck.rows.length > 0) {
      return res.status(400).json({ error: 'El SKU ya existe' });
    }

    // Verificar que marca y tipo existan
    if (marca_id) {
      const marcaCheck = await db.query('SELECT id FROM marcas WHERE id = $1', [marca_id]);
      if (marcaCheck.rows.length === 0) {
        return res.status(400).json({ error: 'Marca no encontrada' });
      }
    }

    if (tipo_id) {
      const tipoCheck = await db.query('SELECT id FROM tipos_producto WHERE id = $1', [tipo_id]);
      if (tipoCheck.rows.length === 0) {
        return res.status(400).json({ error: 'Tipo de producto no encontrado' });
      }
    }

    const query = `
      INSERT INTO productos (
        nombre, sku, precio, precio_mayor, precio_cliente, 
        stock, marca_id, tipo_id, fecha_creacion, fecha_actualizacion
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
      RETURNING *
    `;

    const result = await db.query(query, [
      nombre,
      sku,
      parseFloat(precio) || 0,
      parseFloat(precio_mayor) || 0,
      parseFloat(precio_cliente) || 0,
      parseInt(stock) || 0,
      marca_id || null,
      tipo_id || null
    ]);

    res.status(201).json({
      message: 'Producto creado exitosamente',
      producto: result.rows[0]
    });

  } catch (error) {
    console.error('Error creando producto:', error);
    res.status(500).json({ error: 'Error al crear el producto' });
  }
});

// Actualizar un producto existente
app.put('/productos/:id', verificarToken, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      nombre,
      sku,
      precio,
      precio_mayor,
      precio_cliente,
      stock,
      marca_id,
      tipo_id
    } = req.body;

    // Verificar que el producto existe
    const productoCheck = await db.query('SELECT id FROM productos WHERE id = $1', [id]);
    if (productoCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    // Si se está cambiando el SKU, verificar que no exista
    if (sku) {
      const skuCheck = await db.query('SELECT id FROM productos WHERE sku = $1 AND id != $2', [sku, id]);
      if (skuCheck.rows.length > 0) {
        return res.status(400).json({ error: 'El SKU ya existe en otro producto' });
      }
    }

    // Verificar que marca y tipo existan si se están actualizando
    if (marca_id) {
      const marcaCheck = await db.query('SELECT id FROM marcas WHERE id = $1', [marca_id]);
      if (marcaCheck.rows.length === 0) {
        return res.status(400).json({ error: 'Marca no encontrada' });
      }
    }

    if (tipo_id) {
      const tipoCheck = await db.query('SELECT id FROM tipos_producto WHERE id = $1', [tipo_id]);
      if (tipoCheck.rows.length === 0) {
        return res.status(400).json({ error: 'Tipo de producto no encontrado' });
      }
    }

    const query = `
      UPDATE productos SET
        nombre = COALESCE($1, nombre),
        sku = COALESCE($2, sku),
        precio = COALESCE($3, precio),
        precio_mayor = COALESCE($4, precio_mayor),
        precio_cliente = COALESCE($5, precio_cliente),
        stock = COALESCE($6, stock),
        marca_id = COALESCE($7, marca_id),
        tipo_id = COALESCE($8, tipo_id),
        fecha_actualizacion = NOW()
      WHERE id = $9
      RETURNING *
    `;

    const result = await db.query(query, [
      nombre,
      sku,
      precio ? parseFloat(precio) : null,
      precio_mayor ? parseFloat(precio_mayor) : null,
      precio_cliente ? parseFloat(precio_cliente) : null,
      stock ? parseInt(stock) : null,
      marca_id,
      tipo_id,
      id
    ]);

    res.json({
      message: 'Producto actualizado exitosamente',
      producto: result.rows[0]
    });

  } catch (error) {
    console.error('Error actualizando producto:', error);
    res.status(500).json({ error: 'Error al actualizar el producto' });
  }
});

// Eliminar un producto
app.delete('/productos/:id', verificarToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Verificar que el producto existe
    const productoCheck = await db.query('SELECT id, nombre, sku FROM productos WHERE id = $1', [id]);
    if (productoCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    const producto = productoCheck.rows[0];

    // Verificar si el producto está siendo usado en ventas
    const ventasCheck = await db.query('SELECT COUNT(*) FROM ventas_detalle WHERE sku = $1', [producto.sku]);
    const ventasCount = parseInt(ventasCheck.rows[0].count);

    if (ventasCount > 0) {
      return res.status(400).json({ 
        error: 'No se puede eliminar el producto porque está siendo usado en ventas',
        ventas_asociadas: ventasCount
      });
    }

    // Eliminar el producto
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

// Actualizar stock de un producto
app.patch('/productos/:id/stock', verificarToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { stock, operacion, cantidad, motivo } = req.body; // operacion: 'set', 'add', 'subtract'

    // Verificar que el producto existe
    const productoCheck = await db.query('SELECT id, nombre, sku, stock FROM productos WHERE id = $1', [id]);
    if (productoCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    const producto = productoCheck.rows[0];
    let nuevoStock = producto.stock;

    // Calcular nuevo stock según la operación
    switch (operacion) {
      case 'set':
        nuevoStock = parseInt(stock);
        break;
      case 'add':
        nuevoStock = producto.stock + parseInt(cantidad || 0);
        break;
      case 'subtract':
        nuevoStock = producto.stock - parseInt(cantidad || 0);
        if (nuevoStock < 0) {
          return res.status(400).json({ error: 'El stock no puede ser negativo' });
        }
        break;
      default:
        return res.status(400).json({ error: 'Operación inválida. Use: set, add, o subtract' });
    }

    // Actualizar stock
    const result = await db.query(
      'UPDATE productos SET stock = $1, fecha_actualizacion = NOW() WHERE id = $2 RETURNING *',
      [nuevoStock, id]
    );

    res.json({
      message: 'Stock actualizado exitosamente',
      producto: result.rows[0],
      operacion_realizada: {
        operacion,
        stock_anterior: producto.stock,
        stock_nuevo: nuevoStock,
        diferencia: nuevoStock - producto.stock,
        motivo: motivo || 'Actualización manual'
      }
    });

  } catch (error) {
    console.error('Error actualizando stock:', error);
    res.status(500).json({ error: 'Error al actualizar el stock' });
  }
});

// Búsqueda de productos por SKU o nombre
app.get('/productos/buscar/:busqueda', verificarToken, async (req, res) => {
  const { busqueda } = req.params;

  try {
    const query = `
      SELECT 
        p.id,
        p.nombre,
        p.sku,
        p.precio,
        p.precio_mayor,
        p.precio_cliente,
        p.stock,
        p.fecha_creacion,
        p.fecha_actualizacion,
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
    const result = await db.query(`
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
    const ordenResult = await db.query(`
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
      db.query('SELECT * FROM verificaciones_equipo WHERE orden_id = $1', [ordenId]),
      db.query('SELECT * FROM fallas WHERE orden_id = $1', [ordenId]),
      db.query(`
        SELECT orp.*, p.nombre AS repuesto_nombre 
        FROM orden_repuestos orp
        LEFT JOIN productos p ON orp.repuesto_id = p.id
        WHERE orp.orden_id = $1
      `, [ordenId]),
      db.query('SELECT * FROM fotos_orden WHERE orden_id = $1', [ordenId])
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
    const result = await db.query(`
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

    // SOLUCIÓN TEMPORAL: Solo crear una falla si no existe
    // El estado_reparacion se calculará dinámicamente en el GET
    const fallasExistentes = await client.query('SELECT COUNT(*) FROM fallas WHERE orden_id = $1', [id]);
    
    if (parseInt(fallasExistentes.rows[0].count) === 0) {
      // Si no hay fallas, crear una falla por defecto
      await client.query(
        `INSERT INTO fallas (orden_id, descripcion) VALUES ($1, $2)`,
        [id, 'Falla general']
      );
    }

    await client.query('COMMIT');
    
    res.json({ 
      message: 'Estado de reparación procesado correctamente',
      orden_id: id,
      estado_reparacion: estado_reparacion,
      nota: 'Se creó una falla por defecto. Para almacenar el estado, agregar columna estado a la tabla fallas.',
      instruccion: 'Ejecutar: ALTER TABLE fallas ADD COLUMN estado VARCHAR(50) DEFAULT \'PENDIENTE\';'
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

// Endpoint de prueba para verificar estructura de tabla
app.get('/productos/test/estructura', verificarToken, async (req, res) => {
  try {
    // Verificar si la tabla existe y su estructura
    const estructuraQuery = `
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'productos'
      ORDER BY ordinal_position
    `;
    
    const estructuraResult = await db.query(estructuraQuery);
    
    // Verificar si hay productos
    const countQuery = 'SELECT COUNT(*) as total FROM productos';
    const countResult = await db.query(countQuery);
    
    // Verificar si hay marcas y tipos
    const marcasQuery = 'SELECT COUNT(*) as total FROM marcas';
    const marcasResult = await db.query(marcasQuery);
    
    const tiposQuery = 'SELECT COUNT(*) as total FROM tipos_producto';
    const tiposResult = await db.query(tiposQuery);
    
    res.json({
      estructura_tabla: estructuraResult.rows,
      total_productos: parseInt(countResult.rows[0].total),
      total_marcas: parseInt(marcasResult.rows[0].total),
      total_tipos: parseInt(tiposResult.rows[0].total),
      mensaje: 'Estructura de tabla verificada'
    });
    
  } catch (error) {
    console.error('Error verificando estructura:', error);
    res.status(500).json({ 
      error: 'Error verificando estructura de tabla',
      detalle: error.message,
      stack: error.stack
    });
  }
});

// Endpoint simple para ver qué columnas tiene la tabla productos
app.get('/productos/test/columnas', verificarToken, async (req, res) => {
  try {
    // Ver solo las columnas que existen
    const query = 'SELECT * FROM productos LIMIT 1';
    const result = await db.query(query);
    
    if (result.rows.length > 0) {
      const columnas = Object.keys(result.rows[0]);
      res.json({
        columnas_disponibles: columnas,
        ejemplo_producto: result.rows[0],
        mensaje: 'Columnas encontradas en la tabla productos'
      });
    } else {
      res.json({
        columnas_disponibles: [],
        mensaje: 'La tabla productos está vacía'
      });
    }
    
  } catch (error) {
    console.error('Error verificando columnas:', error);
    res.status(500).json({ 
      error: 'Error verificando columnas',
      detalle: error.message
    });
  }
});

