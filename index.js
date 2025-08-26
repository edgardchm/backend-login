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
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
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





// =================== SERVER ===================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});
